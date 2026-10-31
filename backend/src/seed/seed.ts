import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { GlobalRole } from '../common/enums/global-role.enum';
import 'dotenv/config';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'cerebro',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'cerebro_operativo',
    entities: [User, Project, ProjectMember],
    synchronize: true,
  });

  await dataSource.initialize();
  console.log('📦 Conexión a la base de datos establecida');

  const usersRepo = dataSource.getRepository(User);

  // Crear usuario ADMIN
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@miempresa.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const existingAdmin = await usersRepo.findOne({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log(`⚠️  El usuario admin (${adminEmail}) ya existe. Seed omitido.`);
  } else {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const admin = usersRepo.create({
      email: adminEmail,
      password: hashedPassword,
      globalRole: GlobalRole.ADMIN,
    });
    await usersRepo.save(admin);
    console.log(`✅ Usuario ADMIN creado: ${adminEmail}`);
  }

  // Crear usuario USER de ejemplo
  const userEmail = 'usuario@miempresa.com';
  const existingUser = await usersRepo.findOne({
    where: { email: userEmail },
  });

  if (!existingUser) {
    const hashedPassword = await bcrypt.hash(process.env.SEED_USER_PASSWORD || 'changeme', 10);
    const user = usersRepo.create({
      email: userEmail,
      password: hashedPassword,
      globalRole: GlobalRole.USER,
    });
    await usersRepo.save(user);
    console.log(`✅ Usuario USER creado: ${userEmail}`);
  }

  await dataSource.destroy();
  console.log('🎉 Seed completado exitosamente');
}

seed().catch((error) => {
  console.error('❌ Error en seed:', error);
  process.exit(1);
});
