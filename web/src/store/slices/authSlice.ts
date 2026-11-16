import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
  signature?: string;
  is_admin?: boolean;
  totp_enabled?: boolean;
}

export interface AuthState {
  user: UserProfile | null;
  isAuthLoading: boolean;
  isSetupRequired: boolean;
  setupTokenRequired: boolean;
  setupInfo: { domain?: string; hostname?: string };
}

const initialState: AuthState = {
  user: null,
  isAuthLoading: true,
  isSetupRequired: false,
  setupTokenRequired: false,
  setupInfo: {},
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<UserProfile | null>) => {
      state.user = action.payload;
      state.isAuthLoading = false;
    },
    setAuthLoading: (state, action: PayloadAction<boolean>) => {
      state.isAuthLoading = action.payload;
    },
    setSetupRequired: (
      state,
      action: PayloadAction<{
        required: boolean;
        tokenRequired?: boolean;
        info?: { domain?: string; hostname?: string };
      }>
    ) => {
      state.isSetupRequired = action.payload.required;
      state.setupTokenRequired = !!action.payload.tokenRequired;
      if (action.payload.info) {
        state.setupInfo = action.payload.info;
      }
      state.isAuthLoading = false;
    },
  },
});

export const { setUser, setAuthLoading, setSetupRequired } = authSlice.actions;

export default authSlice.reducer;
