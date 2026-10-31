import { IsString, MaxLength } from 'class-validator';

export class ProjectLinkDto {
  @IsString()
  @MaxLength(160)
  label: string;

  @IsString()
  @MaxLength(2048)
  url: string;
}
