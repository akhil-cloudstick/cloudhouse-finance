import { QueryClient } from "@tanstack/react-query";

// Shared client: AuthProvider clears it on sign-out so one user's cached data never reaches the next.
export const queryClient = new QueryClient();
