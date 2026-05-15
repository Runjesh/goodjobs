import toast from 'react-hot-toast';

/** Success toast that states what happened and offers one next-step CTA. */
export function toastSuccessWithNext(
  message: string,
  next: { label: string; onClick: () => void },
  icon: string = '✓',
): void {
  toast.success(
    (t) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <span>{message}</span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
          onClick={() => {
            toast.dismiss(t.id);
            next.onClick();
          }}
        >
          {next.label} →
        </button>
      </span>
    ),
    { duration: 6000, icon },
  );
}
