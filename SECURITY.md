# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's **Report a vulnerability** form:
<https://github.com/MrStnr21/stockpot/security/advisories/new>. Do not open a public issue,
discussion or pull request for a security problem.

If GitHub shows no **Report a vulnerability** button there, private reporting is not available
yet. Open an issue that asks for a private channel instead, and leave out every detail of the
problem; you will be contacted to continue privately.

A useful report says which version or commit you tested, how to reproduce the problem, and what an
attacker could do with it. You will get an answer in the advisory, and disclosure is coordinated
with you once a fix or mitigation is available.

## Supported versions

stockpot has not been released yet. Once it is, security fixes go into the latest release.

## Scope

In scope: the stockpot server and web app, and the install files in this repository. stockpot is
built for a private Tailscale network but is meant to be safe on the open internet, so a problem
that needs the instance to be exposed publicly is still in scope.

Out of scope: the services stockpot talks to (language model providers, Tailscale, push services)
and problems that need an attacker who already controls the owner's device or server.
