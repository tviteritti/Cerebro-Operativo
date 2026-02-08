import { IsString, IsUUID } from 'class-validator';

export class AssignMemberDto {
  @IsUUID()
  userId: string;

  @IsString()
  projectRole: string;
}
