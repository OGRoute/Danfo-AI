import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// DanfoAI only uses Clerk in the browser (sign-in form, session, UserButton);
// nothing calls auth() on the server. With real keys, clerkMiddleware would
// make every first page load wait on a redirect to Clerk's servers (the
// dev-browser handshake), so a slow or flaky connection to Clerk left the app
// blank for minutes. Keyless development mode does need the middleware to sync
// its temporary keys. If server-side auth() is ever added, run clerkMiddleware
// with real keys too.
const keyless =
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NODE_ENV === "development" &&
  !/^(1|true)$/i.test(process.env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED || "");

export default keyless
  ? clerkMiddleware()
  : function middleware() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
