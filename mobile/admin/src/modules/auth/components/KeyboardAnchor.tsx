import React from "react";

type KeyboardAnchorProps = { children: React.ReactNode };

// ---------------------------------------------------------------------------
// Keyboard handling
//
// Deliberately boring: a KeyboardAvoidingView pads the screen by the
// keyboard's height, and the brand panel collapses to a slim bar while the
// keyboard is up so the form and its button fit above it. Everything is a
// plain layout change. Earlier versions moved the form with a native-driver
// transform, then with an animated ScrollView.scrollTo + LayoutAnimation —
// both broke taps on Android: a transform leaves touch targets at the old
// positions, and while a ScrollView is animating it captures every tap
// (ScrollView._handleStartShouldSetResponderCapture → _isAnimating), so the
// input never received the press and the keyboard bounced.

/** Kept so screens can mark their primary button; layout needs no measuring. */
export function KeyboardAnchor({ children }: KeyboardAnchorProps) {
  return <>{children}</>;
}
