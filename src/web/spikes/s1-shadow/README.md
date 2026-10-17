# S1: Tailwind in a shadow root (PLAN-0062)

    npm install && npx @tailwindcss/cli -i src/tw4.css -o out/tw4.css
    node node_modules/tailwind3/lib/cli.js -c tailwind3.config.cjs -i src/tw3.css -o out/tw3.css
    npx esbuild src/probe.jsx --bundle --format=iife --outfile=out/probe.js --jsx=automatic --define:process.env.NODE_ENV='"production"'
    CHROMIUM=/path/to/chrome node run.mjs            # Tailwind 3, 3 with rem in px, 4; host root 16 px and 20 px

`plugin/` is the probe as a CloudCLI plugin. It was installed through CloudCLI's
own install route (`POST /api/plugins/install`, which accepts only `https://` or
`git@` URLs, so a git `insteadOf` rule in the server's HOME pointed a fake URL at
the local repository). `cloudcli.mjs` and `cloudcli-phone.mjs` open it in CloudCLI
1.37.5 at 1280 and 360 px, with `CC_TOKEN` a CloudCLI login token. CloudCLI's
project path must sit under its HOME and outside `/tmp`.
