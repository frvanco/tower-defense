export type ToastKind = 'info' | 'warn' | 'danger';

let container: HTMLElement | null = null;

export function initToasts(el: HTMLElement): void {
  container = el;
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}
