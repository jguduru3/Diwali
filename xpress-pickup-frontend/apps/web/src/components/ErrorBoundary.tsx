// A class component (React has no hook for error boundaries) plus its screen.
/* eslint-disable react-refresh/only-export-components */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from './ui';

function CrashScreen() {
  const { t } = useTranslation();
  return (
    <Card className="mx-auto mt-10 max-w-xl p-8 text-center">
      <h1 role="alert" className="text-2xl font-semibold">
        {t('crash.title')}
      </h1>
      <p className="mt-2 text-muted">{t('crash.body')}</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        {t('crash.reload')}
      </Button>
    </Card>
  );
}

/**
 * Catches render errors so one broken screen shows a reload card instead of a
 * blank app. `resetKey` (the path) clears it when the person navigates away.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean; key?: string }
> {
  override state: { failed: boolean; key?: string } = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { failed: boolean; key?: string },
  ) {
    if (props.resetKey !== state.key) return { failed: false, key: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
