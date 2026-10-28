import { configure } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// CI runners are slower than laptops: allow lazy-loaded screens time to appear.
configure({ asyncUtilTimeout: 10000 });
