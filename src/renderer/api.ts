import type { LibraryApi } from "../shared/contracts";
declare global {
  interface Window {
    libraryApi: LibraryApi;
  }
}
export const api = window.libraryApi;
