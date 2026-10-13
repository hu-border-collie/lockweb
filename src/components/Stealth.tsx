import { createContext, useContext } from "react";
export const StealthContext = createContext(false);
export const useStealth = () => useContext(StealthContext);
