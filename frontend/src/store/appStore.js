import { create } from "zustand";
import { api } from "../services/api";

export const useAppStore = create(set => ({
  loading: true,
  bootstrap: null,
  dashboard: null,
  error: null,
  async loadBootstrap() {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get("/bootstrap");
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
      const { data } = await api.get(`/${role}/dashboard`);
      set({ dashboard: data });
      return data;
    } catch (error) {
      set({ error: error.message });
      return null;
    }
  }
}));
