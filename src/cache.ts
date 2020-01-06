
import { RedisPool } from './pool';

export interface Serialize<T> {
	(value: T): string;
}

export interface Deserialize<T> {
	(value: string): T;
}

export interface CachePassthrough<T, Params> {
	(params: Params) : T | Promise<T>;
}

export interface CacheOptions<T, Params> {
	ttl?: number;
	serializeKey: Serialize<Params>;
	serializeValue: Serialize<T>;
	deserializeValue: Deserialize<T>;
	passthrough: CachePassthrough<T, Params>;
}

export class RedisCache<T, Params> {
	protected readonly ttl: number;
	protected readonly serializeKey: Serialize<Params>;
	protected readonly serializeValue: Serialize<T>;
	protected readonly deserializeValue: Deserialize<T>;
	protected readonly passthrough: CachePassthrough<T, Params>;

	constructor(protected readonly pool: RedisPool, options: CacheOptions<T, Params>) {
		this.ttl = options.ttl;
		this.serializeKey = options.serializeKey;
		this.serializeValue = options.serializeValue;
		this.deserializeValue = options.deserializeValue;
		this.passthrough = options.passthrough;
	}

	protected async get(key: string) {
		const result = await this.pool.get(key);

		if (result) {
			return this.deserializeValue(result);
		}
	}

	protected async set(key: string, value: T) {
		try {
			const serialized = this.serializeValue(value);

			await this.pool.set(key, serialized, this.ttl);
		}

		catch (error) {
			// We swallow errors on set, because we don't want to actually wait for it. Better
			// that the cache fails to set, but we get to return faster.
			this.pool.logger.warn('Error occured while updating a value in cache', { error });
		}
	}

	protected async invalidate(params: Params) {
		const key = this.serializeKey(params);

		await this.pool.del([ key ]);
	}

	public readonly proxy = async (params: Params) => {
		const key = this.serializeKey(params);
		const fromCache = await this.get(key);

		if (fromCache) {
			return fromCache;
		}

		const value = await this.passthrough(params);

		this.set(key, value);

		return value;
	};
}
