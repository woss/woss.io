import { error, type RequestEvent } from '@sveltejs/kit';
import { getPosts } from '$lib/server/db';

export async function GET({ params }: RequestEvent<{ mdSlug: string }>): Promise<Response> {
	const slug = params.mdSlug.replace(/\.md$/, '');
	const post = getPosts(slug)[0];
	if (!post) throw error(404, 'Post not found');

	return new Response(post.content, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'max-age=3600, s-maxage=3600',
		},
	});
}
