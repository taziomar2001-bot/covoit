import { I } from './lib/icons.js';
import { $, esc, toast } from './lib/util.js';
import * as api from './lib/api.js';

let view='login';
let signupPhotoFile=null, signupPhotoUrl=null, signupHasCar=false;

export function renderAuth(){
  $('#topbar').hidden=true; $('#nav').hidden=true;
  const sc=$('#screen'); sc.className='screen';
  sc.innerHTML = view==='login'?viewLogin():viewSignup();
  sc.classList.add('pop');
}
function viewLogin(){
  return `<div class="auth">
    <div class="auth-top"><div class="auth-logo">Co</div><div class="auth-h">Welcome back</div><div class="auth-p">Sign in to see who's heading to campus.</div></div>
    <div class="auth-form">
      <div class="field"><label class="label">Email</label><input class="inp" id="li-email" type="email" placeholder="you@university.edu"></div>
      <div class="field"><label class="label">Password</label><input class="inp" id="li-pass" type="password" placeholder="••••••••"></div>
      <div style="text-align:right;margin:-6px 2px 16px"><a class="mut" style="font-size:13px" onclick="AV.forgot()">Forgot password?</a></div>
      <button class="btn primary" id="li-btn" onclick="AV.login()">Log in</button>
    </div>
    <div class="auth-link" onclick="AV.goto('signup')">New here? <b>Create an account</b></div>
  </div>`;
}
function viewSignup(){
  return `<div class="auth">
    <div class="auth-top" style="padding-top:calc(28px + env(safe-area-inset-top,0))"><div class="auth-h" style="text-align:left">Create your account</div><div class="auth-p" style="text-align:left;margin-left:0">Takes 30 seconds. Join your class group right away.</div></div>
    <div class="auth-form">
      <div class="photo-pick" onclick="AV.pickPhoto()"><div class="pp-ava" id="su-ava" style="${signupPhotoUrl?`background-image:url(${signupPhotoUrl});border-style:solid`:''}">${signupPhotoUrl?'':I.cam}</div><div><div class="pp-t">Add a photo <span class="mut">· optional</span></div><div class="pp-d">Helps classmates recognise you</div></div></div>
      <div class="grid2"><div class="field"><label class="label">First name</label><input class="inp" id="su-first" placeholder="Omar"></div><div class="field"><label class="label">Last name</label><input class="inp" id="su-last" placeholder="Tazi"></div></div>
      <div class="field"><label class="label">Email</label><input class="inp" id="su-email" type="email" placeholder="you@university.edu"></div>
      <div class="field"><label class="label">Phone number</label><input class="inp" id="su-phone" type="tel" placeholder="+34 600 000 000"><div class="mut" style="font-size:12px;margin-top:7px;display:flex;gap:7px;align-items:flex-start">${I.info}<span>Only shared with people you actually share a ride with — never public to the group.</span></div></div>
      <div class="field"><label class="label">Password</label><input class="inp" id="su-pass" type="password" placeholder="Choose a password (min 6 chars)"></div>
      <div class="switch" onclick="AV.toggleCar()"><div><div class="st">I have a car</div><div class="sd">Add vehicle details later in Profile</div></div><div class="tog ${signupHasCar?'on':''}" id="su-cartog"></div></div>
      <div class="field"><label class="label">Group invite code <span class="mut">· optional</span></label><input class="inp" id="su-code" placeholder="e.g. MIM27" style="text-transform:uppercase"><div class="mut" style="font-size:12px;margin-top:7px;display:flex;gap:7px;align-items:flex-start">${I.info}<span>Have a code from a classmate? Enter it and your group's rides are ready the moment you're in.</span></div></div>
      <button class="btn primary" id="su-btn" onclick="AV.signup()">Create account</button>
    </div>
    <div class="auth-link" onclick="AV.goto('login')">Already have an account? <b>Log in</b></div>
  </div>`;
}

async function login(){
  const email=$('#li-email').value.trim(), pass=$('#li-pass').value;
  if(!email||!pass){ toast('Enter your email and password'); return; }
  const btn=$('#li-btn'); btn.disabled=true; btn.textContent='Signing in…';
  try{ await api.signIn(email,pass); /* onAuthStateChange in main.js takes over */ }
  catch(e){ btn.disabled=false; btn.textContent='Log in'; toast(friendly(e)); }
}
async function signup(){
  const first=$('#su-first').value.trim(), last=$('#su-last').value.trim(),
        email=$('#su-email').value.trim(), phone=$('#su-phone').value.trim(),
        pass=$('#su-pass').value, code=$('#su-code').value.trim();
  if(!first||!email||!pass){ toast('Name, email and password are required'); return; }
  if(pass.length<6){ toast('Password must be at least 6 characters'); return; }
  const btn=$('#su-btn'); btn.disabled=true; btn.textContent='Creating…';
  try{
    const res=await api.signUp({ email, password:pass, first, last, phone });
    if(!res.session){ // email confirmation required
      btn.disabled=false; btn.textContent='Create account';
      toast('Check your email to confirm your account, then log in');
      view='login'; renderAuth();
      return;
    }
    // signed in immediately: finish profile extras
    window.__pendingSignup = { photoFile: signupPhotoFile, hasCar: signupHasCar, code };
    /* main.js onAuthStateChange handles post-signup setup */
  }catch(e){ btn.disabled=false; btn.textContent='Create account'; toast(friendly(e)); }
}
async function forgot(){
  const email=$('#li-email').value.trim();
  if(!email){ toast('Enter your email first'); return; }
  try{ await api.resetPassword(email); toast('Password reset link sent'); }catch(e){ toast('Could not send reset email'); }
}
function toggleCar(){ signupHasCar=!signupHasCar; $('#su-cartog')?.classList.toggle('on',signupHasCar); }
function goto(v){ view=v; renderAuth(); }
function pickPhoto(){
  const inp=$('#filepick'); inp.value='';
  inp.onchange=()=>{ const f=inp.files[0]; if(!f) return; signupPhotoFile=f;
    const rd=new FileReader(); rd.onload=()=>{ signupPhotoUrl=rd.result; const a=$('#su-ava'); if(a){a.style.backgroundImage=`url(${signupPhotoUrl})`;a.style.borderStyle='solid';a.innerHTML='';} }; rd.readAsDataURL(f); };
  inp.click();
}
function friendly(e){ const m=String(e.message||e).toLowerCase();
  if(m.includes('invalid login')) return 'Wrong email or password';
  if(m.includes('already registered')||m.includes('exists')) return 'That email already has an account';
  if(m.includes('rate')) return 'Too many attempts — wait a moment';
  return e.message||'Something went wrong'; }

export const AV = { login, signup, forgot, toggleCar, goto, pickPhoto };
