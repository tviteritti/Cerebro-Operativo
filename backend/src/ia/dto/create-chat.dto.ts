import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatDto {
  @IsIn(['persistent', 'ephemeral'])
  kind: 'persistent' | 'ephemeral';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
