import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

import wowzaLogo from '../../images/wowza-logo.svg';
import wowzaMark from '../../images/wowza-mark.svg';
import useTheme from '../../hooks/useTheme';

/*
 * Left navigation rail: icons only when collapsed, labels when expanded, utility links at the
 * foot. Keyboard reachable in both states. Connection status lives in the topbar, not here.
 */

/* A camera: this page is where the video comes from. */
const PublishIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m22 8-6 4 6 4V8z" />
  </svg>
);

const PlayIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 4l14 8-14 8z" />
  </svg>
);

const BothIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="8" height="14" rx="1" /><rect x="13" y="5" width="8" height="14" rx="1" />
  </svg>
);

const DocsIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" /><path d="M8 7h7M8 11h7" />
  </svg>
);

const PortalIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const GitHubIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </svg>
);

const SunIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

const Chevron = ({ open }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
  </svg>
);

const PAGES = [
  { to: '/publish', label: 'Publish', Icon: PublishIcon },
  { to: '/play', label: 'Play', Icon: PlayIcon },
  { to: '/loopback', label: 'Publish + Play', Icon: BothIcon },
];

const UTILITIES = [
  { href: 'https://www.wowza.com/docs/wowza-streaming-engine-product-articles', label: 'Docs', Icon: DocsIcon },
  { href: 'https://developer.wowza.com', label: 'Developer Portal', Icon: PortalIcon },
  { href: 'https://github.com/WowzaMediaSystems/webrtc-examples', label: 'GitHub', Icon: GitHubIcon },
];

const Rail = () => {
  const [open, setOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <nav className={'wz-rail' + (open ? ' wz-rail--open' : '')} id="top-nav" aria-label="Main">
      <div className="wz-rail__brand">
        {/* Collapsed, the rail still shows the Wowza mark. */}
        {open
          ? <img className="wz-rail__logo" src={wowzaLogo} alt="Wowza Media Systems" />
          : <img className="wz-rail__mark" src={wowzaMark} alt="Wowza" />}
      </div>

      {PAGES.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => 'wz-rail__link' + (isActive ? ' wz-rail__link--active' : '')}
          aria-label={open ? undefined : label}
          title={open ? undefined : label}
        >
          <Icon />
          {open ? <span className="wz-rail__label">{label}</span> : null}
        </NavLink>
      ))}

      <div className="wz-rail__spacer" />
      <div className="wz-rail__rule" />

      {UTILITIES.map(({ href, label, Icon }) => (
        <a
          key={href}
          className="wz-rail__link wz-rail__util"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={open ? undefined : label}
          title={open ? undefined : label}
        >
          <Icon />
          {open ? <span className="wz-rail__label">{label}</span> : null}
        </a>
      ))}

      {/* Sits with the utility links: a reading preference, not a page. */}
      <button
        type="button"
        className="wz-rail__link wz-rail__util"
        id="theme-toggle"
        onClick={toggleTheme}
        aria-label={open ? undefined : `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={open ? undefined : `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        {open ? <span className="wz-rail__label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span> : null}
      </button>

      <button
        type="button"
        className="wz-rail__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
      >
        <Chevron open={open} />
        {open ? <span>Collapse</span> : null}
      </button>
    </nav>
  );
};

export default Rail;