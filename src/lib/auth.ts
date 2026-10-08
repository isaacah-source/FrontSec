import {
  InteractionRequiredAuthError, PublicClientApplication, type AccountInfo,
} from "@azure/msal-browser";
import type { AppConfig } from "./config";
import { BASE } from "./config";

/**
 * Microsoft 365 sign-in. People use their normal work account; the token lets the app act
 * as that person against OneDrive, so it can only open what has been shared with them.
 */
export const SCOPES = ["User.Read", "Files.ReadWrite.All"];

export class Auth {
  private pca: PublicClientApplication;
  account: AccountInfo | null = null;

  constructor(cfg: AppConfig) {
    this.pca = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        redirectUri: new URL(BASE, window.location.origin).href,
        postLogoutRedirectUri: new URL(BASE, window.location.origin).href,
      },
      // localStorage keeps people signed in across visits and installed-app launches.
      cache: { cacheLocation: "localStorage" },
    });
  }

  /** Finishes a sign-in redirect if one is in progress; returns the signed-in account. */
  async init(): Promise<AccountInfo | null> {
    await this.pca.initialize();
    const result = await this.pca.handleRedirectPromise();
    this.account = result?.account ?? this.pca.getActiveAccount() ?? this.pca.getAllAccounts()[0] ?? null;
    if (this.account) this.pca.setActiveAccount(this.account);
    return this.account;
  }

  signIn() {
    // Redirect rather than popup: popups are unreliable on phones and installed apps.
    return this.pca.loginRedirect({ scopes: SCOPES, prompt: "select_account" });
  }

  signOut() {
    return this.pca.logoutRedirect({ account: this.account });
  }

  async token(): Promise<string> {
    if (!this.account) throw new Error("Not signed in.");
    try {
      return (await this.pca.acquireTokenSilent({ scopes: SCOPES, account: this.account })).accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        await this.pca.acquireTokenRedirect({ scopes: SCOPES, account: this.account });
      }
      throw e;
    }
  }
}
