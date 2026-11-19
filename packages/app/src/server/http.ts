// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * HTTP conventions for API routes: every route declares its access with `route.public` or
 * `route.authorized`, every error is JSON (`{ error: { code, message, issues? } }`), and request
 * bodies are read through `readJson`, which caps their size and validates them with Valibot.
 */
import type { APIContext } from 'astro'
import * as v from 'valibot'

import { isAllowed, type Access, type Owner } from './policy'

export interface ErrorDetails {
	/** A stable, machine-readable reason, such as `unauthorized`. */
	readonly code: string
	readonly message: string
	/** One line per invalid field, for a body that failed validation. */
	readonly issues?: string[]
}

export interface ErrorBody {
	readonly error: ErrorDetails
}

export function jsonError(status: number, error: ErrorDetails): Response {
	const body: ErrorBody = { error }

	return Response.json(body, { status })
}

/** Thrown inside a route to answer with a JSON error; the route wrapper turns it into the response. */
export class HttpError extends Error {
	public override readonly name = 'HttpError'
	public readonly status: number
	public readonly details: ErrorDetails

	public constructor(status: number, details: ErrorDetails) {
		super(details.message)
		this.status = status
		this.details = details
	}

	public toResponse(): Response {
		return jsonError(this.status, this.details)
	}
}

/**
 * What the wrappers need from Astro's context; specs pass just these. `locals` is partial because
 * nothing guarantees the middleware ran: a missing owner counts as nobody.
 */
export interface RouteContext {
	readonly request: Request
	readonly locals: Partial<App.Locals>
	readonly isPrerendered?: boolean
}

type Reply = Response | Promise<Response>

type Route<TContext> = (context: TContext) => Promise<Response>

const unauthorized = { code: 'unauthorized', message: 'Sign in to do this.' }

// Handlers made by `route`, so the route check can tell a declared route from a bare one.
const declaredRoutes = new Set<unknown>()

function declare<TContext extends RouteContext>(
	access: Access,
	handler: (context: TContext, owner: Owner | null) => Reply,
): Route<TContext> {
	async function declared(context: TContext) {
		const owner = context.locals.owner ?? null

		// A prerendered response would be served as a file to anyone, signed in or not.
		if (access === 'authorized' && context.isPrerendered === true) {
			throw new Error(
				'route.authorized cannot be prerendered: remove `export const prerender = true` from the route',
			)
		}

		if (!isAllowed(access, owner)) {
			return jsonError(401, unauthorized)
		}

		try {
			return await handler(context, owner)
		} catch (error) {
			// Anything else propagates, so Astro logs it with its stack and answers 500.
			if (error instanceof HttpError) {
				return error.toResponse()
			}

			throw error
		}
	}

	declaredRoutes.add(declared)

	return declared
}

export const route = {
	/** A route anyone may call, signed in or not. */
	public<TContext extends RouteContext = APIContext>(
		handler: (context: TContext) => Reply,
	): Route<TContext> {
		return declare('public', handler)
	},
	/** A route for the signed-in owner; anyone else gets 401 before the handler runs. */
	authorized<TContext extends RouteContext = APIContext>(
		handler: (context: TContext, owner: Owner) => Reply,
	): Route<TContext> {
		return declare<TContext>('authorized', async (context, owner) => {
			// `declare` has answered 401 already; this narrows the type for the handler.
			if (owner === null) {
				throw new HttpError(401, unauthorized)
			}

			return handler(context, owner)
		})
	},
}

const httpMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'ALL'] as const

type HttpMethod = (typeof httpMethods)[number]

/** The handlers an Astro endpoint module may export, one per method. */
export type RouteModule = Readonly<Partial<Record<HttpMethod, (context: never) => Reply>>>

/** The HTTP methods a route module exports without `route.public` or `route.authorized`. */
export function undeclaredHandlers(module: RouteModule): HttpMethod[] {
	return httpMethods.filter(
		(method) => module[method] !== undefined && !declaredRoutes.has(module[method]),
	)
}

/* A note with its context is a few kilobytes; 64 KiB leaves room without letting a client make the
 * server buffer much. The Node adapter's 1 MiB `bodySizeLimit` is the backstop for everything else. */
export const defaultBodyLimit = 64 * 1024

function tooLarge(maxBytes: number) {
	return new HttpError(413, {
		code: 'body_too_large',
		message: `The body is larger than ${maxBytes} bytes.`,
	})
}

/** The body as text, read no further than `maxBytes`, whatever `Content-Length` claimed. */
async function readCapped(request: Request, maxBytes: number) {
	const decoder = new TextDecoder()
	let size = 0
	let text = ''

	if (request.body !== null) {
		for await (const chunk of request.body) {
			size += chunk.byteLength

			if (size > maxBytes) {
				throw tooLarge(maxBytes)
			}

			text += decoder.decode(chunk, { stream: true })
		}
	}

	return text + decoder.decode()
}

function describeIssue(issue: v.BaseIssue<unknown>) {
	return `${v.getDotPath(issue) ?? 'body'}: ${issue.message}`
}

/**
 * Reads a JSON body: 415 unless it is sent as JSON, 413 past `maxBytes`, 400 when it is not JSON or
 * does not match the schema, with one issue per field.
 */
export async function readJson<TSchema extends v.GenericSchema>(
	request: Request,
	schema: TSchema,
	maxBytes = defaultBodyLimit,
): Promise<v.InferOutput<TSchema>> {
	if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
		throw new HttpError(415, {
			code: 'unsupported_media_type',
			message: 'Send the body as application/json.',
		})
	}

	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
		throw tooLarge(maxBytes)
	}

	const text = await readCapped(request, maxBytes)
	const parsed = v.safeParse(v.pipe(v.string(), v.parseJson()), text)

	if (!parsed.success) {
		throw new HttpError(400, { code: 'invalid_json', message: 'The body is not valid JSON.' })
	}

	const result = v.safeParse(schema, parsed.output)

	if (!result.success) {
		throw new HttpError(400, {
			code: 'invalid_body',
			message: 'The body does not match what this route accepts.',
			issues: result.issues.map(describeIssue),
		})
	}

	return result.output
}
