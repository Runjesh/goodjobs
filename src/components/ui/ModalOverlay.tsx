import React from 'react';

export type ModalOverlayProps = {
  children: React.ReactNode;
  /** Click the dimmed backdrop (outside the panel) to dismiss */
  onBackdropClick?: () => void;
  /** Use when this dialog must stack above others (e.g. login MFA) */
  elevated?: boolean;
  className?: string;
};

/**
 * Shared modal backdrop: theme tokens, z-index, blur, mobile bottom-sheet alignment.
 * Wrap a `.modal-card` (or custom panel) as child; call `stopPropagation` on the panel
 * so clicks inside do not close the dialog.
 */
export function ModalOverlay({ children, onBackdropClick, elevated, className }: ModalOverlayProps) {
  return (
    <div
      className={['modal-overlay', elevated ? 'modal-overlay--elevated' : '', className || ''].filter(Boolean).join(' ')}
      role="presentation"
      onClick={
        onBackdropClick
          ? (e) => {
              if (e.target === e.currentTarget) onBackdropClick();
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
