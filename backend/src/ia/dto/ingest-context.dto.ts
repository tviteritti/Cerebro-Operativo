import { IsOptional, IsString } from 'class-validator';

export class IngestContextDto {
  @IsString()
  @IsOptional()
  additionalContext?: string;
}
