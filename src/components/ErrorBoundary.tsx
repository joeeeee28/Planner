import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IconAlertTriangle, IconRefresh } from './icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in Growth OS UI:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'var(--bg-app, #f8fafc)',
            color: 'var(--text-main, #0f172a)',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: '100%',
              background: 'var(--bg-card, #ffffff)',
              borderRadius: 16,
              padding: 32,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--border-color, #e2e8f0)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <IconAlertTriangle size={24} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted, #64748b)', margin: '0 0 24px', lineHeight: 1.5 }}>
              Growth OS encountered an unexpected rendering error. Your data remains safe in local storage & cloud backup.
            </p>
            <button
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 8,
                background: 'var(--accent-color, #0d9488)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <IconRefresh size={16} /> Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
