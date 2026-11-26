// Every EXPO_PUBLIC_* variable the app reads — keep in step with .env.example.
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE_URL?: string;
  }
}
