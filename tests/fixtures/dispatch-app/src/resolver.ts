import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { Kysely } from 'kysely';

interface DB { asset: { id: string }; exif: { assetId: string } }

@Resolver()
export class AssetResolver {
  constructor(private db: Kysely<DB>) {}

  @Query(() => String)
  assets(): Promise<unknown[]> {
    return this.db.selectFrom('asset as a').innerJoin('exif', 'exif.assetId', 'a.id').selectAll().execute();
  }

  @Mutation(() => Boolean, { name: 'deleteAsset' })
  async remove(id: string): Promise<boolean> {
    await this.db.deleteFrom('asset').where('id', '=', id).execute();
    return true;
  }
}
