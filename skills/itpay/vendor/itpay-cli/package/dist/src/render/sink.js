// Centralised output sink used by every command. Lets tests silence
// stdout while still letting the real CLI write to the terminal.
export const defaultOutput = (line) => process.stdout.write(line);
export function resolveOutput(sink) {
    return sink ?? defaultOutput;
}
