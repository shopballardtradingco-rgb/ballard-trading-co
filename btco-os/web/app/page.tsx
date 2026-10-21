import {requireChatGPTUser} from './chatgpt-auth';
import VaultClient from './vault-client';
export const dynamic='force-dynamic';
export default async function Home(){const user=await requireChatGPTUser('/');return <VaultClient userId={user.userId}/>;}
