package addons

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"micromail/internal/store"
)

type WASMRunner struct {
	runtime wazero.Runtime
	modules sync.Map // map[addonID]wazero.CompiledModule
	store   *store.Store
	dataDir string
}

func NewWASMRunner(ctx context.Context, dataDir string, s *store.Store) (*WASMRunner, error) {
	r := wazero.NewRuntime(ctx)
	// Instantiate WASI snapshot preview 1
	wasi_snapshot_preview1.MustInstantiate(ctx, r)

	runner := &WASMRunner{
		runtime: r,
		store:   s,
		dataDir: dataDir,
	}

	// Precompile all installed and enabled backend addons
	if s != nil {
		enabledAddons, err := s.ListEnabledAddons()
		if err == nil {
			for _, a := range enabledAddons {
				var mf Manifest
				if err := json.Unmarshal([]byte(a.ManifestJSON), &mf); err == nil {
					if mf.Backend != nil && mf.Backend.Wasm != "" {
						wasmPath := filepath.Join(dataDir, "addons", a.ID, mf.Backend.Wasm)
						if err := runner.CompileModule(a.ID, a.Version, wasmPath); err != nil {
							log.Printf("[WASM] Error compiling %s: %v", a.ID, err)
						} else {
							log.Printf("[WASM] Precompiled module %s v%s", a.ID, a.Version)
						}
					}
				}
			}
		}
	}

	return runner, nil
}

func (wr *WASMRunner) Close(ctx context.Context) error {
	return wr.runtime.Close(ctx)
}

func (wr *WASMRunner) CompileModule(addonID, version, wasmPath string) error {
	wasmData, err := os.ReadFile(wasmPath)
	if err != nil {
		return fmt.Errorf("failed to read wasm file: %w", err)
	}

	ctx := context.Background()
	compiled, err := wr.runtime.CompileModule(ctx, wasmData)
	if err != nil {
		return fmt.Errorf("failed to compile wasm module %s: %w", addonID, err)
	}

	wr.modules.Store(addonID, compiled)
	return nil
}

func (wr *WASMRunner) RemoveModule(addonID string) {
	if val, ok := wr.modules.LoadAndDelete(addonID); ok {
		if cm, ok := val.(wazero.CompiledModule); ok {
			_ = cm.Close(context.Background())
		}
	}
}

// RunInboundPreStoreHook runs all registered backend addons for 'on_inbound_pre_store'
func (wr *WASMRunner) RunInboundPreStoreHook(email InboundEmailData) (*HookOutput, error) {
	enabledAddons, err := wr.store.ListEnabledAddons()
	if err != nil {
		return &HookOutput{Action: "accept", SpamScore: 0.0, Tags: []string{}}, nil
	}

	finalOutput := &HookOutput{
		Action:    "accept",
		SpamScore: 0.0,
		Tags:      []string{},
	}

	for _, a := range enabledAddons {
		var mf Manifest
		if err := json.Unmarshal([]byte(a.ManifestJSON), &mf); err != nil {
			continue
		}
		if mf.Backend == nil || mf.Backend.Wasm == "" {
			continue
		}

		hasHook := false
		for _, h := range mf.Backend.Hooks {
			if h == "on_inbound_pre_store" {
				hasHook = true
				break
			}
		}
		if !hasHook {
			continue
		}

		// Ensure module is compiled
		var compiled wazero.CompiledModule
		if val, ok := wr.modules.Load(a.ID); ok {
			compiled = val.(wazero.CompiledModule)
		} else {
			wasmPath := filepath.Join(wr.dataDir, "addons", a.ID, mf.Backend.Wasm)
			if err := wr.CompileModule(a.ID, a.Version, wasmPath); err == nil {
				if val, ok := wr.modules.Load(a.ID); ok {
					compiled = val.(wazero.CompiledModule)
				}
			}
		}

		if compiled == nil {
			log.Printf("[WASM] Addon %s has no compiled module; skipping", a.ID)
			continue
		}

		timeout := 1500 * time.Millisecond
		if mf.Backend.TimeoutMS > 0 {
			timeout = time.Duration(mf.Backend.TimeoutMS) * time.Millisecond
		}

		var cfgMap map[string]any
		_ = json.Unmarshal([]byte(a.ConfigJSON), &cfgMap)
		if cfgMap == nil {
			cfgMap = make(map[string]any)
		}

		input := HookInput{
			Hook:   "on_inbound_pre_store",
			Config: cfgMap,
			Email:  email,
		}

		output, err := wr.executeModule(compiled, input, timeout)
		if err != nil {
			log.Printf("[WASM] Addon %s execution failed: %v (defaulting to accept)", a.ID, err)
			continue
		}

		if output.SpamScore > finalOutput.SpamScore {
			finalOutput.SpamScore = output.SpamScore
		}
		if len(output.Tags) > 0 {
			finalOutput.Tags = append(finalOutput.Tags, output.Tags...)
		}
		if output.Action == "reject" {
			finalOutput.Action = "reject"
			return finalOutput, nil
		}
		if output.Action == "spam" && finalOutput.Action != "reject" {
			finalOutput.Action = "spam"
		}
	}

	return finalOutput, nil
}

func (wr *WASMRunner) executeModule(compiled wazero.CompiledModule, input HookInput, timeout time.Duration) (*HookOutput, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer

	// Unique random instance name for concurrent runs
	instanceName := fmt.Sprintf("exec-%d", time.Now().UnixNano())

	modConfig := wazero.NewModuleConfig().
		WithName(instanceName).
		WithStdin(bytes.NewReader(inputBytes)).
		WithStdout(&stdoutBuf).
		WithStderr(&stderrBuf)

	mod, err := wr.runtime.InstantiateModule(ctx, compiled, modConfig)
	if mod != nil {
		defer mod.Close(ctx)
	}

	if err != nil {
		return nil, fmt.Errorf("module run error: %w (stderr: %s)", err, stderrBuf.String())
	}

	var output HookOutput
	if err := json.Unmarshal(stdoutBuf.Bytes(), &output); err != nil {
		return nil, fmt.Errorf("failed to parse guest stdout JSON: %w (stdout: %s)", err, stdoutBuf.String())
	}

	if output.Action == "" {
		output.Action = "accept"
	}

	return &output, nil
}
