import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from './auth.guard';
import { FirebaseVerifier, firebaseJwksProvider } from './firebase-verifier';

@Module({
  imports: [UsersModule, DevicesModule],
  providers: [FirebaseVerifier, firebaseJwksProvider, AuthGuard],
  exports: [AuthGuard, FirebaseVerifier],
})
export class AuthModule {}
