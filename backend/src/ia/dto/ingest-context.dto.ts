import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class IngestContextDto {
  @IsString()
  @IsOptional()
  additionalContext?: string;

  /** Sincroniza con Git (pull/clone) antes de indexar. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    return value === true || value === 'true' || value === 1 || value === '1';
  })
  @IsBoolean()
  syncFromGit?: boolean;
}
