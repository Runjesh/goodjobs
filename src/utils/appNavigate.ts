/** App-wide navigate hook registered from Layout (React Router). */
let navigateFn: ((path: string) => void) | null = null;

export function registerAppNavigate(fn: (path: string) => void): void {
  navigateFn = fn;
}

export function appNavigate(path: string): void {
  if (navigateFn) {
    navigateFn(path);
    return;
  }
  window.location.assign(path);
}
