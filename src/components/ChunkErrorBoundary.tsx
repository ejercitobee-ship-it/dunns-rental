import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches chunk-load failures caused by Cloudflare deploying new JS bundles
 * while the browser still has old HTML cached (the old chunk filenames no
 * longer exist). On error, it shows a brief message and reloads the page
 * so the browser fetches the new HTML with the correct chunk references.
 *
 * The reload uses a sessionStorage flag to avoid an infinite reload loop:
 * if the page has already been reloaded once in this session for this
 * reason, it shows a manual "Reload" button instead.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const isChunkError =
      error.message?.includes('Failed to fetch dynamically imported module') ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('Importing a module script failed') ||
      error.name === 'ChunkLoadError';

    if (isChunkError) {
      const key = 'chunk-reload-attempted';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return;
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-lg font-display font-semibold text-ink mb-2">
              Something went wrong
            </p>
            <p className="text-sm text-muted mb-6">
              A new version of the app was deployed. Please reload to get the latest version.
            </p>
            <button
              onClick={() => {
                sessionStorage.removeItem('chunk-reload-attempted');
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
