import { useEffect, useState, type ReactNode } from 'react';

/** Bouton en deux temps : un premier clic demande confirmation, le second agit. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirmer ?',
  className = 'btn btn-plain btn-sm btn-danger',
  ariaLabel,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      aria-label={armed ? confirmLabel : ariaLabel}
      style={armed ? { background: 'var(--err-bg)', borderColor: 'var(--err-bd)', width: 'auto', padding: '0 12px' } : undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
