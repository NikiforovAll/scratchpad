// Test preload (bunfig.toml): keep CLI output plain so string assertions are
// deterministic whether tests run piped or on an interactive TTY.
process.env.NO_COLOR = "1";
