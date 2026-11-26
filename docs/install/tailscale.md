# Serve stockpot over HTTPS with Tailscale

This guide puts stockpot, running on your Mac as [Run stockpot on a Mac](macos.md) sets it up,
behind `tailscale serve`. Your iPhone then opens it at an HTTPS address with a valid certificate,
such as `https://stockpot.example.ts.net`, and nothing outside your tailnet can reach it. The app's
service worker and its notifications work only over HTTPS.

## What you need

- Tailscale on the Mac and on the iPhone, both signed in to the same tailnet.
- The `tailscale` command on the Mac. The Standalone app installs it from **Settings**, under CLI
  integration. The App Store app keeps it inside the app, at
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
  ([Tailscale CLI](https://tailscale.com/kb/1080/cli)).
- MagicDNS and HTTPS certificates turned on for the tailnet. Open the DNS page of the admin console,
  turn on MagicDNS if it is off, and under **HTTPS Certificates** select **Enable HTTPS**
  ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)). Read
  [The address is public](#the-address-is-public) first: enabling HTTPS publishes the machine name.

## Listen on this Mac only

`tailscale serve` takes the requests that reach the Mac over the tailnet and passes them to
stockpot on the Mac's own loopback address, `127.0.0.1`. So stockpot does not need to listen on the
network at all. Set `HOST` in `stockpot.env` to that address:

```sh
HOST='127.0.0.1'
```

Then only this Mac and `tailscale serve` reach the port: other devices on your Wi-Fi do not, so
every request from another device arrives over HTTPS. Do not use `0.0.0.0`, which opens the port to
every network the Mac is on.

Do not leave `HOST` at its default, `localhost`, either. stockpot then listens on the IPv6 loopback
address `::1` alone, and `tailscale serve` cannot reach it there.

## Start `tailscale serve`

Pass the port stockpot listens on, `4321` unless you set `PORT`:

```sh
tailscale serve --bg 4321
```

`--bg` keeps it running after the command returns. It answers HTTPS on port 443 at the Mac's
MagicDNS name, and gets the certificate for that name itself. It prints the address:

```text
Available within your tailnet:

https://stockpot.example.ts.net/
|-- proxy http://127.0.0.1:4321

Serve started and running in the background.
To disable the proxy, run: tailscale serve --https=443 off
```

The setting stays until you turn it off. When the Mac restarts, or Tailscale goes down and up
again, it resumes on its own
([tailscale serve](https://tailscale.com/kb/1242/tailscale-serve)). stockpot itself starts again
when you log in.

To see what is being served:

```sh
tailscale serve status
```

To stop serving stockpot, run the command it printed. `tailscale serve reset` instead clears
everything `tailscale serve` does on this Mac, stockpot and anything else:

```sh
tailscale serve --https=443 off
```

## Set the public origin

stockpot must know the address it is opened at. Set `STOCKPOT_PUBLIC_ORIGIN` in `stockpot.env` to
the HTTPS address `tailscale serve` printed, `https://` included and no port:

```sh
HOST='127.0.0.1'
STOCKPOT_PUBLIC_ORIGIN='https://stockpot.example.ts.net'
```

Restart stockpot to read it:

```sh
launchctl kickstart -k gui/$(id -u)/local.stockpot
```

With an HTTPS address set, the sign-in cookie is `Secure` and takes the `__Host-` prefix, which a
browser accepts only over HTTPS from this exact host. When the address does not match the one in
the browser:

- a browser that sends `Origin` but not `Sec-Fetch-Site` is refused every change, signing in and
  saving a note included, with "Requests from another site are refused";
- left at the default `http://localhost:4321`, the cookie loses `Secure` and the prefix;
- the setup code in the log points at the wrong address.

Browsers that send `Sec-Fetch-Site` pass the check either way, so a working sign-in does not prove
the address is right. Compare it with the one `tailscale serve` printed.

## Check it

On the iPhone, with Tailscale connected:

1. Open the address in Safari. It loads without a certificate warning.
2. Open `/healthz` at the same address, such as `https://stockpot.example.ts.net/healthz`. It
   answers with `"database": "ok"`.
3. Sign in, or create the owner at `/setup` the first time
   ([Sign in the first time](macos.md#sign-in-the-first-time)), and save a note.

On the Mac, `tailscale serve status` lists the same address.

## The address is public

Every HTTPS certificate is written to public Certificate Transparency logs, which anyone can search.
A certificate from Tailscale names the machine and the tailnet, such as
`stockpot.example.ts.net`, so both become public the moment the first one is issued, and stay
public.

If the machine name says something you would not publish, such as your name, rename the machine in
the admin console before you enable HTTPS or run `tailscale serve` for the first time
([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)). Renaming changes the MagicDNS
name, and so the address. A name already in the logs stays there.

The address being known does not let anyone in: only devices in your tailnet can connect to it.

## Stay on the tailnet

This guide needs `tailscale serve` only. Do not run `tailscale funnel` for stockpot: Funnel serves
the same port to the whole internet, not only to your tailnet
([tailscale serve](https://tailscale.com/kb/1242/tailscale-serve)). The phone reaches stockpot
through the tailnet, so nothing here needs it.
