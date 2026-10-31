import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectLinkDto } from './project-link.dto';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  context_data?: Record<string, any>;

  @IsObject()
  @IsOptional()
  infrastructure_urls?: Record<string, any>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectLinkDto)
  @IsOptional()
  projectLinks?: ProjectLinkDto[];

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  gitRepositoryUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  gitDefaultBranch?: string;

  @IsString()
  @IsOptional()
  localRepositoryPath?: string | null;
}
