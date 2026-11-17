// How far (dp) the open bottom sheet is currently lifted above its resting place to clear the keyboard.
// On Android that lift is a native-driven transform, which measureInWindow only sometimes includes (not
// while the animation has not been committed): a field in the lifted sheet then measures at its resting
// position, and a dropdown anchored to it opened exactly that far too low — yet subtracting the lift
// blindly put it too high when the measure did include it. `probe` asks the sheet itself, by comparing
// where it was measured with where it rests and where it would be lifted, and answers with how much of
// the lift the field's measured position is missing (0 when it already includes it).
export const sheetLift: {
  value: number;
  probe: null | ((done: (missing: number) => void) => void);
} = { value: 0, probe: null };
