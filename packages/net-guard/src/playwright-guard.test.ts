import { describe, expect, test, vi } from 'vitest';
import type { Page } from 'playwright';
import { DEFAULT_MAX_REDIRECTS, guardPage } from './playwright-guard.js';

type RouteHandler = (route: FakeRoute) => void;

class FakeRequest {
  private readonly targetUrl: string;
  private readonly navigation: boolean;
  private readonly ownerFrame: unknown;

  constructor(targetUrl: string, navigation: boolean, ownerFrame: unknown) {
    this.targetUrl = targetUrl;
    this.navigation = navigation;
    this.ownerFrame = ownerFrame;
  }

  url(): string {
    return this.targetUrl;
  }

  isNavigationRequest(): boolean {
    return this.navigation;
  }

  frame(): unknown {
    return this.ownerFrame;
  }
}

class FakeRoute {
  continued = false;
  abortedWith: string | undefined;
  private readonly fakeRequest: FakeRequest;

  constructor(fakeRequest: FakeRequest) {
    this.fakeRequest = fakeRequest;
  }

  request(): FakeRequest {
    return this.fakeRequest;
  }

  continue(): Promise<void> {
    this.continued = true;
    return Promise.resolve();
  }

  abort(errorCode?: string): Promise<void> {
    this.abortedWith = errorCode ?? 'failed';
    return Promise.resolve();
  }
}

function createFakePage(): { page: Page; dispatch: (route: FakeRoute) => Promise<void> } {
  const mainFrame = { name: 'main' };
  let handler: RouteHandler | undefined;

  const page = {
    route: (_pattern: string, routeHandler: RouteHandler) => {
      handler = routeHandler;
      return Promise.resolve();
    },
    mainFrame: () => mainFrame,
  } as unknown as Page;

  return {
    page,
    dispatch: async (route: FakeRoute) => {
      if (handler === undefined) throw new Error('route handler was not registered');
      handler(route);
      // The handler resolves the SSRF check asynchronously; give it a tick.
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    },
  };
}

function navigationRoute(url: string, frame: unknown): FakeRoute {
  return new FakeRoute(new FakeRequest(url, true, frame));
}

function subResourceRoute(url: string, frame: unknown): FakeRoute {
  return new FakeRoute(new FakeRequest(url, false, frame));
}

describe('guardPage', () => {
  test('allows a public main-frame navigation', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn(() => Promise.resolve(['93.184.216.34']));
    await guardPage(page, { resolve });

    const route = navigationRoute('https://example.com/', page.mainFrame());
    await dispatch(route);

    expect(route.continued).toBe(true);
    expect(route.abortedWith).toBeUndefined();
  });

  test('aborts a main-frame navigation to a private address', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn(() => Promise.resolve(['127.0.0.1']));
    await guardPage(page, { resolve });

    const route = navigationRoute('https://rebind.example.com/', page.mainFrame());
    await dispatch(route);

    expect(route.abortedWith).toBe('blockedbyclient');
    expect(route.continued).toBe(false);
  });

  test('re-checks every redirect, not just the initial request', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn((hostname: string) =>
      Promise.resolve(
        hostname === 'evil-redirect.example.com' ? ['169.254.169.254'] : ['93.184.216.34'],
      ),
    );
    await guardPage(page, { resolve });

    await dispatch(navigationRoute('https://example.com/', page.mainFrame()));
    const redirected = navigationRoute('https://evil-redirect.example.com/', page.mainFrame());
    await dispatch(redirected);

    expect(redirected.abortedWith).toBe('blockedbyclient');
  });

  test('aborts once the redirect chain exceeds the configured maximum', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn(() => Promise.resolve(['93.184.216.34']));
    await guardPage(page, { resolve, maxRedirects: 2 });

    // Initial navigation + 2 redirects are allowed (3 total); the 4th trips it.
    for (let index = 0; index < 3; index += 1) {
      const route = navigationRoute(`https://example.com/${String(index)}`, page.mainFrame());
      await dispatch(route);
      expect(route.abortedWith).toBeUndefined();
    }

    const overflow = navigationRoute('https://example.com/overflow', page.mainFrame());
    await dispatch(overflow);
    expect(overflow.abortedWith).toBe('blockedbyclient');
  });

  test('does not intercept sub-resource requests or other frames', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn(() =>
      Promise.reject(new Error('should not be called for sub-resources')),
    );
    await guardPage(page, { resolve });

    const subResource = subResourceRoute('https://example.com/style.css', page.mainFrame());
    await dispatch(subResource);
    expect(subResource.continued).toBe(true);

    const otherFrame = navigationRoute('https://example.com/iframe', { name: 'iframe' });
    await dispatch(otherFrame);
    expect(otherFrame.continued).toBe(true);
  });

  test('exposes a sane default redirect budget', () => {
    expect(DEFAULT_MAX_REDIRECTS).toBeGreaterThan(0);
  });

  test('forwards allowHostnames so a fixture server origin can be permitted', async () => {
    const { page, dispatch } = createFakePage();
    const resolve = vi.fn(() => Promise.reject(new Error('should not be called')));
    await guardPage(page, { resolve, allowHostnames: new Set(['127.0.0.1:4173']) });

    const route = navigationRoute('http://127.0.0.1:4173/fixture.html', page.mainFrame());
    await dispatch(route);

    expect(route.continued).toBe(true);
    expect(route.abortedWith).toBeUndefined();
  });
});
