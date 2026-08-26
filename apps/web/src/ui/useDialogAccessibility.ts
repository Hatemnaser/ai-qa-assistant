import {
  nextTick,
  onBeforeUnmount,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogAccessibilityOptions = {
  canClose?: MaybeRefOrGetter<boolean>;
  isOpen: MaybeRefOrGetter<boolean>;
  onClose: () => void;
};

type ReleaseLock = () => void;

export function createReferenceCountedLock(
  onFirstAcquire: () => void,
  onLastRelease: () => void
) {
  let activeLocks = 0;

  return function acquire(): ReleaseLock {
    if (activeLocks === 0) onFirstAcquire();
    activeLocks += 1;
    let released = false;

    return () => {
      if (released) return;

      released = true;
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0) onLastRelease();
    };
  };
}

let previousBodyStyles: { overflow: string; paddingRight: string } | null = null;

const acquireBodyScrollLock = createReferenceCountedLock(
  () => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const body = document.body;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth
    );
    previousBodyStyles = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    body.style.overflow = "hidden";
  },
  () => {
    if (typeof document === "undefined" || !previousBodyStyles) return;

    document.body.style.overflow = previousBodyStyles.overflow;
    document.body.style.paddingRight = previousBodyStyles.paddingRight;
    previousBodyStyles = null;
  }
);

export function getFocusWrapTarget<T>(
  focusableElements: readonly T[],
  activeElement: unknown,
  shiftKey: boolean
): T | null {
  const firstElement = focusableElements[0];
  const lastElement = focusableElements.at(-1);

  if (!firstElement || !lastElement) return null;

  const activeIndex = focusableElements.indexOf(activeElement as T);

  if (shiftKey) {
    return activeIndex <= 0 ? lastElement : null;
  }

  return activeIndex === -1 || activeIndex === focusableElements.length - 1
    ? firstElement
    : null;
}

export function shouldRequestDialogClose(
  key: string,
  canClose: boolean,
  isComposing = false
) {
  return key === "Escape" && canClose && !isComposing;
}

function isAvailableForFocus(element: HTMLElement) {
  if (
    element.hidden ||
    element.closest('[aria-hidden="true"]') ||
    element.closest("[inert]") ||
    element.matches(":disabled")
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function getFocusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isAvailableForFocus
  );
}

function focusElement(element: HTMLElement | null) {
  if (!element) return;

  element.focus({ preventScroll: true });
}

export function useDialogAccessibility(options: DialogAccessibilityOptions) {
  const dialogRef = ref<HTMLElement | null>(null);
  let focusRevision = 0;
  let opener: HTMLElement | null = null;
  let releaseBodyScrollLock: ReleaseLock | null = null;

  function canClose() {
    return options.canClose === undefined || toValue(options.canClose);
  }

  function captureOpener() {
    if (typeof document === "undefined" || typeof HTMLElement === "undefined") return;

    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  }

  function restoreOpener() {
    const elementToRestore = opener;
    opener = null;

    if (!elementToRestore?.isConnected) return;

    focusElement(elementToRestore);
  }

  async function focusDialog(revision: number) {
    await nextTick();

    if (revision !== focusRevision || !toValue(options.isOpen)) return;

    const dialog = dialogRef.value;
    if (!dialog) return;

    const autofocusTarget = dialog.querySelector<HTMLElement>("[autofocus]");
    const firstFocusableElement = getFocusableElements(dialog)[0] || null;

    focusElement(
      autofocusTarget && isAvailableForFocus(autofocusTarget)
        ? autofocusTarget
        : firstFocusableElement || dialog
    );
  }

  async function restoreFocus(revision: number) {
    await nextTick();

    if (revision !== focusRevision || toValue(options.isOpen)) return;

    restoreOpener();
  }

  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();

      if (!shouldRequestDialogClose(event.key, canClose(), event.isComposing)) return;

      event.preventDefault();
      options.onClose();
      return;
    }

    if (event.key !== "Tab" || event.defaultPrevented) return;

    const dialog = dialogRef.value;
    if (!dialog) return;

    const focusableElements = getFocusableElements(dialog);
    const target = getFocusWrapTarget(
      focusableElements,
      typeof document === "undefined" ? null : document.activeElement,
      event.shiftKey
    );

    if (target) {
      event.preventDefault();
      focusElement(target);
      return;
    }

    if (focusableElements.length === 0) {
      event.preventDefault();
      focusElement(dialog);
    }
  }

  watch(
    () => toValue(options.isOpen),
    (isOpen, wasOpen) => {
      const revision = ++focusRevision;

      if (isOpen) {
        captureOpener();
        releaseBodyScrollLock ||= acquireBodyScrollLock();
        void focusDialog(revision);
        return;
      }

      releaseBodyScrollLock?.();
      releaseBodyScrollLock = null;
      if (wasOpen) void restoreFocus(revision);
    },
    { flush: "post", immediate: true }
  );

  onBeforeUnmount(() => {
    focusRevision += 1;
    releaseBodyScrollLock?.();
    releaseBodyScrollLock = null;
    restoreOpener();
  });

  return {
    dialogRef,
    onDialogKeydown,
  };
}
