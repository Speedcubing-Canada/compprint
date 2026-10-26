import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { useIsMobile } from '../lib/useIsMobile';
import LanguageSelect from './LanguageSelect';
import ThemeToggle from './ThemeToggle';
import WhatsNewDialog from './WhatsNewDialog';
import ContactLinks from './ContactLinks';
import Logo from './Logo';
import { APP_ICON, APP_NAME } from '../brand';
import ui from '../styles/ui.module.css';
import s from './Header.module.css';

interface HeaderProps {
  showBack?: boolean;
  onBack?: () => void;
  showUser?: boolean;
  showSignOut?: boolean;
}

export default function Header({ showBack, onBack, showUser, showSignOut = true }: HeaderProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  // The mobile layout swaps the whole control cluster for a menu panel, so this one
  // stays a JS breakpoint: it picks a subtree, not a style.
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const userInfo = showUser && user && (
    <>
      {user.avatar?.thumb_url && <img
        src={user.avatar.thumb_url}
        alt=""
        width={32}
        height={32}
        className={s.avatar}
        onError={(e) => (e.currentTarget.style.display = 'none')}
      />}
      <span className={s.userName}>{user.name}</span>
    </>
  );

  return (
    <header ref={headerRef} className={s.header}>
      <a href="#main" className="skip-link">{t('common.skip_to_content')}</a>
      <div className={s.left}>
        <Logo className={s.logo} />
        <div className={s.divider} />
        {showBack ? (
          <button className={ui.btnSecondary} onClick={onBack}>{t('common.back')}</button>
        ) : (
          <span className={s.title}>
            <img src={APP_ICON} alt="" width={22} height={22} className={s.titleIcon} />
            {APP_NAME}
          </span>
        )}
      </div>

      {isMobile ? (
        <>
          <button
            className={s.hamburger}
            aria-label={t('common.menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={22} strokeWidth={2} /> : <Menu size={22} strokeWidth={2} />}
          </button>

          {menuOpen && (
            <div className={s.menuPanel}>
              <div className={s.menuRow}>
                <LanguageSelect />
                <ThemeToggle />
                <WhatsNewDialog />
                <ContactLinks />
              </div>
              {userInfo && <div className={s.menuUser}>{userInfo}</div>}
              {showSignOut && (
                <button
                  className={s.menuSignOut}
                  onClick={() => { setMenuOpen(false); logout(); }}
                >
                  {t('common.sign_out')}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className={s.right}>
          <LanguageSelect />
          <ThemeToggle />
          <WhatsNewDialog />
          <ContactLinks />
          {userInfo}
          {showSignOut && (
            <button className={ui.btnSecondary} onClick={logout}>
              {t('common.sign_out')}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
