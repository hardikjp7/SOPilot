import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Iocs } from '../api/types';

const groups: { key: keyof Iocs; label: string }[] = [
  { key: 'ips', label: 'IP addresses' },
  { key: 'domains', label: 'Domains' },
  { key: 'urls', label: 'URLs' },
  { key: 'hashes', label: 'Hashes' },
  { key: 'emails', label: 'Emails' },
  { key: 'users', label: 'Users' },
  { key: 'cve_ids', label: 'CVE IDs' },
  { key: 'resources', label: 'Resources' },
];

export default function IocChips({ iocs }: { iocs: Iocs }) {
  const id = useId();
  const [copied, setCopied] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const operation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const populated = groups.filter((group) => iocs[group.key].length > 0);

  useEffect(() => () => {
    operation.current += 1;
    clearTimeout(timer.current);
  }, []);

  async function copy(value: string, key: string) {
    const current = ++operation.current;
    clearTimeout(timer.current);
    setCopied(null);
    setFeedback('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (current !== operation.current) return;
      setCopied(key);
      setFeedback(`Copied ${value} to clipboard.`);
      timer.current = setTimeout(() => { setCopied(null); setFeedback(''); }, 2000);
    } catch {
      if (current !== operation.current) return;
      setFeedback('Could not copy. Select the indicator text and copy it manually.');
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">Indicators of compromise</h3>
        {populated.length > 0 && <p className="text-xs text-muted">Click an indicator to copy</p>}
      </div>
      {populated.length === 0 ? <p className="text-sm text-muted">No indicators returned.</p> : (
        <div className="space-y-4">
          {populated.map(({ key, label }) => (
            <div key={key} role="group" aria-labelledby={`${id}-${key}`}>
              <h4 id={`${id}-${key}`} className="mb-2 text-xs font-medium text-muted">{label}</h4>
              <ul className="flex flex-wrap gap-2">
                {iocs[key].map((value) => {
                  const copyKey = `${key}:${value}`;
                  const Icon = copied === copyKey ? Check : Copy;
                  return (
                    <li key={value} className="min-w-0 max-w-full">
                      <button type="button" aria-label={`Copy ${value}`} onClick={() => void copy(value, copyKey)} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-outline bg-canvas px-2.5 py-2 text-left hover:border-accent">
                        <span className="min-w-0 select-text break-all font-mono text-xs leading-5">{value}</span>
                        <Icon size={13} aria-hidden="true" className={`mt-1 shrink-0 ${copied === copyKey ? 'text-accent' : 'text-muted'}`} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 min-h-5 break-words text-xs leading-5 text-muted" role="status" aria-live="polite">{feedback}</p>
    </section>
  );
}
