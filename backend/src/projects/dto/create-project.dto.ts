import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  context_data?: Record<string, any>;

  @IsObject()
  @IsOptional()
  infrastructure_urls?: Record<string, any>;
}
