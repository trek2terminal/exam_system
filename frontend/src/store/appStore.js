import { create } from "zustand";
import { cachedGet } from "../services/api";

export const useAppStore = create(set => ({
  loading: true,
  bootstrap: null,
  dashboard: null,
  error: null,
  clearSession() {
    set({ bootstrap: null, dashboard: null, error: null, loading: false });
  },
  async loadBootstrap(options = {}) {
    if (!options.silent) set({ loading: true, error: null });
    else set({ error: null });
    try {
      const { data } = await cachedGet("/bootstrap", { cacheTtl: options.silent ? 8000 : 1500 });
      set({ bootstrap: data, loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      return null;
    }
  },
  async loadDashboard(role) {
    if (!role) return null;
    set({ error: null });
    try {
      const { data } = await cachedGet(`/${role}/dashboard`, { cacheTtl: 5000 });
      set({ dashboard: data });
      return data;
    } catch (error) {
      set({ error: error.message });
      return null;
    }
  }
}));
