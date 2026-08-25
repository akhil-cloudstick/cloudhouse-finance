import React, { createContext, useContext } from "react";
import { colors } from "./colors";
import { typeScale } from "./typography";

const ThemeContext = createContext({ colors, typeScale });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={{ colors, typeScale }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
