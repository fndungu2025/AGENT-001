import { createContext, useContext } from "react";
import { makeMoney } from "./format";
import type { MoneyFormatter } from "./format";

export const MoneyContext = createContext<MoneyFormatter>(makeMoney(null));
export function useMoney(): MoneyFormatter {
  return useContext(MoneyContext);
}
