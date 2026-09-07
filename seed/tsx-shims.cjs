/**
 * CJS preload for seed scripts that import real Next.js server actions
 * (see `pnpm seed:states`). tsx transpiles to CommonJS, so interception via
 * `Module._load` reaches every nested require.
 *
 * Only Next's *environment* modules are shimmed — revalidate/headers/cookies
 * have no HTTP request to act on inside a CLI, so calling them is a no-op by
 * definition. Business logic (state machine, ledger, notifications) runs
 * untampered. This file is never loaded by the Next runtime itself.
 */
/* eslint-disable @typescript-eslint/no-require-imports --
 * a CJS preload module; ESM cannot register a Module._load hook */
const Module = require("node:module");

const SHIMS = {
  "next/cache": {
    revalidatePath() {},
    revalidateTag() {},
    updateTag() {},
    updatePath() {},
    unstable_cache(fn) {
      return fn;
    },
    unstable_noStore() {},
  },
  "next/headers": {
    headers: async () => new Map(),
    cookies: async () => ({ get: () => undefined, set() {}, delete() {} }),
    draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
  },
  "next/navigation": {
    redirect: (url) => {
      const err = new Error(`NEXT_REDIRECT:${url}`);
      err.name = "NextRedirect";
      throw err;
    },
    permanentRedirect: (url) => {
      const err = new Error(`NEXT_REDIRECT:${url}`);
      err.name = "NextRedirect";
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {} }),
    useParams: () => ({}),
  },
  "server-only": {},
};

const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(SHIMS, request)) {
    return SHIMS[request];
  }
  return originalLoad.apply(this, [request, ...rest]);
};
