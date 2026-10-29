import { useStore, type Screen } from '../state/store';
import { Icon, Logo, type IconName } from './Icon';

const ITEMS: { screen: Screen; label: string; icon: IconName }[] = [
  { screen: 'workbench', label: 'Atelier', icon: 'beaker' },
  { screen: 'library', label: 'Tests', icon: 'layers' },
];

export function Rail() {
  const screen = useStore((s) => s.screen);
  const theme = useStore((s) => s.data.settings.theme);
  const set = useStore((s) => s.set);
  const updateSettings = useStore((s) => s.updateSettings);

  const link = (target: Screen, label: string, icon: IconName) => (
    <button key={target} className="rail-link" aria-current={screen === target ? 'page' : undefined} onClick={() => set({ screen: target })}>
      <Icon name={icon} size={20} strokeWidth={1.8} />
      {label}
    </button>
  );

  return (
    <nav className="rail" aria-label="Navigation principale">
      <div className="logo" title="GraphQA">
        <Logo />
      </div>
      {ITEMS.map((i) => link(i.screen, i.label, i.icon))}
      <div className="rail-bottom">
        <button
          className="rail-link"
          style={{ minHeight: 44, width: 44 }}
          aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} strokeWidth={1.8} />
        </button>
        {link('settings', 'Réglages', 'gear')}
      </div>
    </nav>
  );
}
