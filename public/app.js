    // ═══════════════════════════════════════════════════════
    //  API & AUTH LAYER
    // ═══════════════════════════════════════════════════════
    const API = '/api';
    let authToken = localStorage.getItem('ft_token') || null;
    let currentUsername = localStorage.getItem('ft_username') || null;
    let syncTimer = null;
    let lastSyncedHash = '';
    let programs = [];
    let schedule = [];
    let workoutHistory = [];
    let achievements = [];
    let currentSeason = null; // Будет инициализировано позже

    function apiHeaders() {
        return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken };
    }

    async function apiFetch(path, opts = {}) {
        const res = await fetch(API + path, { ...opts, headers: apiHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
        return data;
    }

    // ─── Auth forms ─────────────────────────────────────────
    function showAuthTab(tab) {
        const isLogin = tab === 'login';
        document.getElementById('form-login').style.display    = isLogin ? '' : 'none';
        document.getElementById('form-register').style.display = isLogin ? 'none' : '';
        document.getElementById('tab-login-btn').classList.toggle('active',  isLogin);
        document.getElementById('tab-reg-btn').classList.toggle('active',   !isLogin);
        setAuthError('');
    }

    function togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        btn.textContent = isHidden ? '🙈' : '👁️';
    }

    // Очищаем предыдущее значение при фокусе, чтобы не стирать вручную.
    function clearZeroInput(el) {
        if (!el) return;
        el.value = '';
    }

    function normalizeExerciseType(type) {
        return type === 'cardio' ? 'cardio' : 'strength';
    }

    function getExerciseType(exercise) {
        return normalizeExerciseType(exercise?.type);
    }

    function getTypeMeta(type) {
        if (type === 'cardio') {
            return {
                primaryLabel: 'Минуты',
                primaryUnit: 'мин',
                primaryMin: '0',
                primaryPlaceholder: 'Минуты'
            };
        }
        return {
            primaryLabel: 'Вес',
            secondaryLabel: 'Повт.',
            primaryUnit: 'кг',
            secondaryUnit: 'повт.',
            primaryMin: '0',
            secondaryMin: '1',
            primaryPlaceholder: 'Вес',
            secondaryPlaceholder: 'Повт.'
        };
    }

    // ─── Achievements System ─────────────────────────────────────────
    function getCurrentSeason() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    function initializeAchievements() {
        const defaultAchievements = [
            {
                id: 'strength-1000kg',
                name: 'Силач',
                description: 'Сделать 1000кг на одном упражнении за тренировку',
                icon: '🏋️',
                requirement: { type: 'single_exercise_volume', value: 1000 },
                unlocked: false,
                unlockedAt: null
            },
            {
                id: 'cardio-60min',
                name: 'Кардио-мастер',
                description: 'Накопить 60 минут кардио-тренировок',
                icon: '🏃',
                requirement: { type: 'cardio_minutes_total', value: 60 },
                unlocked: false,
                unlockedAt: null
            },
            {
                id: 'gym-enthusiast',
                name: 'Энтузиаст качалки',
                description: 'Тренироваться каждый день в течение сезона',
                icon: '💪',
                requirement: { type: 'daily_streak', value: 7 },
                unlocked: false,
                unlockedAt: null
            }
        ];

        if (!achievements.length) {
            achievements = defaultAchievements.map(a => ({...a}));
            saveAchievements();
        }
    }

    function saveAchievements() {
        localStorage.setItem('ft_achievements', JSON.stringify(achievements));
        localStorage.setItem('ft_current_season', currentSeason);
    }

    function loadAchievements() {
        const saved = localStorage.getItem('ft_achievements');
        const savedSeason = localStorage.getItem('ft_current_season');
        
        // Инициализируем текущий сезон
        if (!currentSeason) {
            currentSeason = getCurrentSeason();
        }
        
        if (saved) {
            achievements = JSON.parse(saved);
        }
        
        if (savedSeason !== getCurrentSeason()) {
            // Новый сезон - сбрасываем прогресс
            currentSeason = getCurrentSeason();
            achievements.forEach(a => {
                a.unlocked = false;
                a.unlockedAt = null;
            });
            saveAchievements();
        }
    }

    function checkAchievements() {
        let newUnlocks = [];
        
        achievements.forEach(achievement => {
            if (achievement.unlocked) return;
            
            let shouldUnlock = false;
            
            switch (achievement.requirement.type) {
                case 'single_exercise_volume':
                    shouldUnlock = checkSingleExerciseVolume(achievement.requirement.value);
                    break;
                case 'cardio_minutes_total':
                    shouldUnlock = checkCardioMinutesTotal(achievement.requirement.value);
                    break;
                case 'daily_streak':
                    shouldUnlock = checkDailyStreak(achievement.requirement.value);
                    break;
            }
            
            if (shouldUnlock) {
                achievement.unlocked = true;
                achievement.unlockedAt = new Date().toISOString();
                newUnlocks.push(achievement);
            }
        });
        
        if (newUnlocks.length > 0) {
            saveAchievements();
            renderAchievements();
            showAchievementUnlocked(newUnlocks);
        }
    }

    function checkSingleExerciseVolume(targetVolume) {
        // Проверяем все тренировки в истории
        for (const workout of workoutHistory) {
            for (const exercise of workout.exercises) {
                if (exercise.type === 'strength') {
                    const totalVolume = exercise.sets.reduce((sum, set) => {
                        return sum + (parseFloat(set.weight) || 0) * (parseFloat(set.reps) || 0);
                    }, 0);
                    if (totalVolume >= targetVolume) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function checkCardioMinutesTotal(targetMinutes) {
        let totalMinutes = 0;
        workoutHistory.forEach(workout => {
            workout.exercises.forEach(exercise => {
                if (exercise.type === 'cardio') {
                    exercise.sets.forEach(set => {
                        totalMinutes += parseFloat(set.weight) || 0;
                    });
                }
            });
        });
        return totalMinutes >= targetMinutes;
    }

    function checkDailyStreak(targetDays) {
        if (workoutHistory.length < targetDays) return false;
        
        const sortedDates = [...new Set(workoutHistory.map(w => w.date))].sort();
        const today = new Date().toISOString().split('T')[0];
        
        let streak = 0;
        let currentDate = new Date(today);
        
        for (let i = 0; i < targetDays; i++) {
            const dateStr = currentDate.toISOString().split('T')[0];
            if (sortedDates.includes(dateStr)) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                break;
            }
        }
        
        return streak >= targetDays;
    }

    function showAchievementUnlocked(unlockedAchievements) {
        const names = unlockedAchievements.map(a => a.name).join(', ');
        showAlert(`🏆 Получена ачивка: ${names}!`, 'success');
    }

    function renderAchievements() {
        const container = document.querySelector('.achievements-placeholder');
        if (!container) return;
        
        const unlockedCount = achievements.filter(a => a.unlocked).length;
        const totalCount = achievements.length;
        
        container.innerHTML = `
            <div class="achievements-title">🏅 Ачивки (${unlockedCount}/${totalCount})</div>
            <div class="achievements-grid">
                ${achievements.map(achievement => `
                    <div class="achievement-item ${achievement.unlocked ? 'unlocked' : 'locked'}" 
                         onclick="showAchievementDetails('${achievement.id}')"
                         title="${achievement.unlocked ? achievement.description : '🔒 ' + achievement.description}">
                        <div class="achievement-icon">${achievement.icon}</div>
                        <div class="achievement-name">${achievement.name}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function showAchievementDetails(achievementId) {
        const achievement = achievements.find(a => a.id === achievementId);
        if (!achievement) return;
        
        const status = achievement.unlocked 
            ? `✅ Получена ${new Date(achievement.unlockedAt).toLocaleDateString('ru')}`
            : '🔒 Еще не получена';
            
        showAlert(`${achievement.icon} ${achievement.name}\n\n${achievement.description}\n\nСтатус: ${status}`, 'info');
    }

    function setAuthError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.classList.toggle('visible', !!msg);
    }

    function setAuthLoading(btnId, loading) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = loading;
        btn.style.opacity = loading ? '0.6' : '1';
    }

    async function doLogin() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        setAuthError('');
        setAuthLoading('login-btn', true);
        try {
            const data = await fetch(API + '/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            }).then(r => r.json());
            if (data.error) { setAuthError(data.error); return; }
            onAuthSuccess(data.token, data.username);
        } catch { setAuthError('Не удалось подключиться к серверу'); }
        finally  { setAuthLoading('login-btn', false); }
    }

    async function doRegister() {
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        setAuthError('');
        setAuthLoading('reg-btn', true);
        try {
            const data = await fetch(API + '/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            }).then(r => r.json());
            if (data.error) { setAuthError(data.error); return; }
            onAuthSuccess(data.token, data.username);
        } catch { setAuthError('Не удалось подключиться к серверу'); }
        finally  { setAuthLoading('reg-btn', false); }
    }

    async function onAuthSuccess(token, username) {
        authToken = token;
        currentUsername = username;
        localStorage.setItem('ft_token', token);
        localStorage.setItem('ft_username', username);
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('user-bar').classList.add('visible');
        document.getElementById('user-bar-name').textContent = username;
        await loadDataFromServer();
        initApp();
    }

    function logout() {
        if (!confirm('Выйти из аккаунта? Все данные сохранены на сервере.')) return;
        localStorage.removeItem('ft_token');
        localStorage.removeItem('ft_username');
        window.location.href = 'index.html';
    }

    // ─── Data sync ───────────────────────────────────────────
    async function loadDataFromServer() {
        try {
            const data = await apiFetch('/data');
            programs = data.programs || [];

            if (Array.isArray(data.schedule) && data.schedule.length === 7) {
                schedule = data.schedule;
            } else {
                schedule = Array(7).fill(null).map(() => ({ workouts: [] }));
            }

            userProfile    = data.profile  || {};
            workoutHistory = data.history  || [];

            const theme = data.theme || 'purple';
            document.body.setAttribute('data-theme', theme);
            updateThemeModal();
            setSyncStatus('saved');
        } catch(e) {
            setSyncStatus('error');
            console.error('Загрузка данных:', e);
        }
    }

    function setSyncStatus(state) {
        const el = document.getElementById('sync-status');
        if (!el) return;
        if (state === 'syncing') {
            el.textContent = '⟳  синхронизация...';
            el.className = 'user-bar-status syncing';
        } else if (state === 'saved') {
            el.textContent = '●  сохранено';
            el.className = 'user-bar-status saved';
        } else {
            el.textContent = '⚠  ошибка сохранения';
            el.className = 'user-bar-status';
        }
    }

    function scheduleSync() {
        clearTimeout(syncTimer);
        setSyncStatus('syncing');
        syncTimer = setTimeout(syncToServer, 1200);
    }

    async function syncToServer() {
        if (!authToken) return;
        const theme = document.body.getAttribute('data-theme') || 'purple';
        const payload = JSON.stringify({ programs, schedule, theme, profile: userProfile, history: workoutHistory });
        if (payload === lastSyncedHash) { setSyncStatus('saved'); return; }
        try {
            await apiFetch('/data', { method: 'PUT', body: payload });
            lastSyncedHash = payload;
            setSyncStatus('saved');
        } catch(e) {
            setSyncStatus('error');
        }
    }

    async function forceSyncNow() {
        clearTimeout(syncTimer);
        lastSyncedHash = '';
        setSyncStatus('syncing');
        await syncToServer();
        showAlert('Данные синхронизированы ✅', 'success');
    }

    // Replace localStorage saves with server sync
    function savePrograms() { scheduleSync(); }
    function saveSchedule() { scheduleSync(); }
    function saveTheme()    { scheduleSync(); }

    // ═══════════════════════════════════════════════════════
    //  APP INIT (called after auth)
    // ═══════════════════════════════════════════════════════
    function initApp() {
        loadAchievements();
        initializeAchievements();
        checkWeeklyReset();
        renderCalendar();
        renderEmojiPicker();
        renderAchievements();
        if (document.getElementById('exercises-list').children.length === 0) addExerciseBlock();
        renderLibrary();
        updateThemeModal();
    }

    // ─── Weekly reset ────────────────────────────────────────
    // Resets only completedSets/setOverrides — keeps programId so user
    // doesn't have to re-assign programs every week.
    function checkWeeklyReset() {
        const today     = new Date();
        const monday    = getMonday(today);
        const mondayStr = monday.toISOString().slice(0, 10);
        const lastReset = userProfile.lastWeeklyReset || '';

        if (lastReset !== mondayStr) {
            // New week — wipe progress but keep program assignments
            schedule = schedule.map(day => ({
                workouts: (day.workouts || []).map(w => ({
                    programId:     w.programId,
                    completedSets: [],
                    setOverrides:  {},
                    exerciseSetCounts: w.exerciseSetCounts || [],
                    finishedAt: null
                })),
            }));
            userProfile.lastWeeklyReset = mondayStr;
            saveSchedule();
            scheduleSync();
        }
    }

    function getMonday(date) {
        const d = new Date(date);
        const day = d.getDay(); // 0=Sun, 1=Mon…
        const diff = (day === 0) ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // ─── Startup ─────────────────────────────────────────────
    window.onload = () => {
        if (authToken) {
            // Try to restore session
            document.getElementById('user-bar').classList.add('visible');
            document.getElementById('user-bar-name').textContent = currentUsername || '';
            loadDataFromServer().then(() => initApp()).catch(() => {
                // Token expired — redirect to landing
                localStorage.removeItem('ft_token');
                localStorage.removeItem('ft_username');
                window.location.href = 'index.html';
            });
        } else {
            // Not logged in — redirect to landing
            window.location.href = 'index.html';
        }
    };

    // ═══════════════════════════════════════════════════════
    //  ORIGINAL APP CODE (localStorage calls replaced above)
    // ═══════════════════════════════════════════════════════
    const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const EMOJIS = ['💪', '🏋️', '🏃', '🧘', '🚴', '🏊', '🥊', '🏀', '⚽', '🎾', '🏸', '🏓', '🥋', '🤸', '🤺', '🏌️', '🧗', '🚣', '🛹', '🛷'];

    // Инициализация schedule если еще не инициализирован
    if (schedule.length === 0) {
        schedule = Array(7).fill(null).map(() => ({ workouts: [] }));
    }


    function resetSchedule() {
        schedule = Array(7).fill(null).map(() => ({ workouts: [] }));
        saveSchedule();
    }

    let editingId = null;
    let selectedIcon = '💪';
    let _exBlockCounter = 0;

    function openThemeModal() {
        document.getElementById('theme-modal').classList.add('active');
        updateThemeModal();
    }

    function closeThemeModal(event) {
        if (event.target === event.currentTarget) {
            document.getElementById('theme-modal').classList.remove('active');
        }
    }

    function setTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        saveTheme();
        updateThemeModal();
        document.getElementById('theme-modal').classList.remove('active');
    }

    function updateThemeModal() {
        const currentTheme = document.body.getAttribute('data-theme') || 'purple';
        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.dataset.theme === currentTheme) opt.classList.add('selected');
        });
    }

    function switchTab(tab) {
        document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        if (tab === 'calendar') {
            document.getElementById('calendar-view').classList.add('active');
            document.querySelectorAll('.nav-btn')[0].classList.add('active');
            renderCalendar();
        } else if (tab === 'create') {
            document.getElementById('create-view').classList.add('active');
            document.querySelectorAll('.nav-btn')[1].classList.add('active');
            const hasPrograms = programs && programs.length > 0;
            if (!hasPrograms) {
                startCreateProgram();
            } else if (!editingId) {
                resetForm();
            }
        } else if (tab === 'library') {
            document.getElementById('library-view').classList.add('active');
            document.querySelectorAll('.nav-btn')[2].classList.add('active');
            renderLibrary();
        } else if (tab === 'profile') {
            document.getElementById('profile-view').classList.add('active');
            document.querySelectorAll('.nav-btn')[3].classList.add('active');
            loadProfileUI();
            renderCharts();
        }
    }

    function renderEmojiPicker() {
        const container = document.getElementById('emoji-picker');
        container.innerHTML = '';
        EMOJIS.forEach(emoji => {
            const div = document.createElement('div');
            div.className = `emoji-option ${emoji === selectedIcon ? 'selected' : ''}`;
            div.textContent = emoji;
            div.onclick = () => {
                selectedIcon = emoji;
                document.querySelectorAll('.emoji-option').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
            };
            container.appendChild(div);
        });
    }

    function addExerciseBlock(initialSets = 3) {
        const container = document.getElementById('exercises-list');
        const blockId = 'ex-block-' + (++_exBlockCounter);
        const block = document.createElement('div');
        block.className = 'exercise-block';
        block.id = blockId;
        const meta = getTypeMeta('strength');
        block.innerHTML = `
            <div class="exercise-header">
                <input type="text" class="exercise-name-input" placeholder="Название упражнения">
                <select class="exercise-type-select" onchange="updateSetInputsForType('${blockId}')">
                    <option value="strength">Силовое</option>
                    <option value="cardio">Кардио</option>
                </select>
                <button class="remove-exercise-btn" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
            <div class="sets-header">
                <span class="sets-header-label">Подходы</span>
                <button class="add-set-btn" onclick="addSetRow('${blockId}')">+ Добавить подход</button>
            </div>
            <div class="sets-container" id="sets-${blockId}"></div>
        `;
        container.appendChild(block);
        for (let i = 0; i < initialSets; i++) addSetRow(blockId, false);
        block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function addSetRow(blockId, scroll = true) {
        const container = document.getElementById('sets-' + blockId);
        if (!container) return;
        const block = document.getElementById(blockId);
        const type = block?.querySelector('.exercise-type-select')?.value || 'strength';
        const meta = getTypeMeta(type);
        const idx = container.querySelectorAll('.set-row').length;
        const row = document.createElement('div');
        row.className = 'set-row';
        
        if (type === 'cardio') {
            // Для кардио только одно поле - минуты
            row.innerHTML = `
                <div class="set-number">${idx + 1}</div>
                <input type="number" class="set-weight-input" placeholder="${meta.primaryPlaceholder}" min="${meta.primaryMin}" inputmode="numeric" onfocus="clearZeroInput(this)">
                <button class="remove-set-btn" onclick="removeSetRow(this)">−</button>
            `;
        } else {
            // Для силовых - вес и повторения
            row.innerHTML = `
                <div class="set-number">${idx + 1}</div>
                <input type="number" class="set-weight-input" placeholder="${meta.primaryPlaceholder}" min="${meta.primaryMin}" inputmode="decimal" onfocus="clearZeroInput(this)">
                <input type="number" class="set-reps-input" placeholder="${meta.secondaryPlaceholder}" min="${meta.secondaryMin}" inputmode="numeric" onfocus="clearZeroInput(this)">
                <button class="remove-set-btn" onclick="removeSetRow(this)">−</button>
            `;
        }
        
        container.appendChild(row);
        if (scroll) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        renumberSets(blockId);
    }

    function updateSetInputsForType(blockId) {
        const block = document.getElementById(blockId);
        if (!block) return;
        const type = block.querySelector('.exercise-type-select')?.value || 'strength';
        const meta = getTypeMeta(type);

        block.querySelectorAll('.set-row').forEach(row => {
            const p = row.querySelector('.set-weight-input');
            const s = row.querySelector('.set-reps-input');
            
            if (p) {
                p.placeholder = meta.primaryPlaceholder;
                p.min = meta.primaryMin;
                p.inputmode = type === 'cardio' ? 'numeric' : 'decimal';
            }
            
            if (type === 'cardio') {
                // Для кардио скрываем второе поле (повторения)
                if (s) s.style.display = 'none';
            } else {
                // Для силовых показываем второе поле
                if (s) {
                    s.style.display = '';
                    s.placeholder = meta.secondaryPlaceholder;
                    s.min = meta.secondaryMin;
                }
            }
        });
    }

    function removeSetRow(btn) {
        const row = btn.parentElement;
        const blockId = row.closest('.exercise-block').id;
        row.remove();
        renumberSets(blockId);
    }

    function renumberSets(blockId) {
        const container = document.getElementById('sets-' + blockId);
        if (!container) return;
        container.querySelectorAll('.set-row').forEach((row, i) => {
            const num = row.querySelector('.set-number');
            if (num) num.textContent = i + 1;
        });
    }

    function resetForm() {
        editingId = null;
        document.getElementById('form-title').textContent = '💪 Новая программа';
        document.getElementById('save-btn').innerHTML = '<span>💾</span><span>Сохранить программу</span>';
        document.getElementById('cancel-btn').style.display = 'none';
        document.getElementById('prog-name').value = '';
        document.getElementById('exercises-list').innerHTML = '';
        selectedIcon = '💪';
        renderEmojiPicker();
        addExerciseBlock();
    }

    function startCreateProgram() {
        resetForm();
        const form = document.getElementById('form-title');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderProgramsList() {
        const list = document.getElementById('library-user-list');
        if (!list) return;
        list.innerHTML = '';

        if (!programs || programs.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="padding:16px 12px;">
                    <div class="empty-state-icon" style="font-size:32px;margin-bottom:8px;">📭</div>
                    <p style="font-size:13px;color:var(--text-2);">
                        У вас пока нет сохранённых программ.<br>
                        Перейдите во вкладку <b>«Программы»</b>, чтобы создать первую.
                    </p>
                </div>
            `;
            return;
        }

        programs.forEach(prog => {
            const div = document.createElement('div');
            div.className = 'program-card';
            div.innerHTML = `
                <div class="program-icon">${prog.icon}</div>
                <div class="program-info">
                    <div class="program-name">${prog.name}</div>
                    <div class="program-exercises">${prog.exercises.length} упражнений</div>
                </div>
                <div class="program-actions">
                    <button class="btn btn-secondary btn-small" onclick="switchTab('create'); editProgram(${prog.id})">✏️ Редактировать</button>
                    <button class="btn btn-primary btn-small" onclick="exportSingleProgram(${prog.id})" title="Экспортировать программу">⬇️ Экспорт</button>
                    <button class="btn btn-danger btn-small" onclick="deleteProgram(${prog.id})">🗑️ Удалить</button>
                </div>
            `;
            list.appendChild(div);
        });
    }

    function saveProgram() {
        const name = document.getElementById('prog-name').value.trim();
        
        if (!name) {
            showAlert('Введите название программы!');
            return;
        }

        const exercises = [];
        document.querySelectorAll('.exercise-block').forEach(block => {
            const exName = block.querySelector('.exercise-name-input').value.trim();
            const exType = normalizeExerciseType(block.querySelector('.exercise-type-select')?.value || 'strength');
            if (exName) {
                const sets = [];
                block.querySelectorAll('.set-row').forEach(row => {
                    const weight = row.querySelector('.set-weight-input').value.trim();
                    const reps = row.querySelector('.set-reps-input')?.value.trim() || '';
                    
                    if (exType === 'cardio') {
                        // Для кардио сохраняем только минуты в поле weight
                        sets.push({ 
                            weight: weight || '0',
                            reps: '0' // для кардио reps не используется
                        });
                    } else {
                        // Для силовых сохраняем и вес, и повторения
                        sets.push({ 
                            weight: weight || '0',
                            reps: reps || '0'
                        });
                    }
                });
                if (sets.length > 0) {
                    exercises.push({ name: exName, type: exType, sets });
                }
            }
        });

        const newProgram = {
            id: editingId || Date.now(),
            name,
            icon: selectedIcon,
            exercises
        };

        if (editingId) {
            const index = programs.findIndex(p => p.id === editingId);
            if (index !== -1) {
                programs[index] = newProgram;
                showAlert('Программа обновлена! ✅', 'success');
            }
        } else {
            programs.push(newProgram);
            showAlert('Программа сохранена! ✅', 'success');
        }

        savePrograms();
        renderProgramsList();
        resetForm();
    }

    function cancelEdit() {
        resetForm();
        renderProgramsList();
    }

    let activeDayIndex = null; // 0..6 — относительный индекс внутри текущей недели
    
    function getCurrentWeekInfo() {
        const today = new Date();
        const monday = getMonday(today);
        const dayMs = 24 * 60 * 60 * 1000;
        const offset = Math.floor((today.getTime() - monday.getTime()) / dayMs);
        const idx = Math.min(Math.max(offset, 0), 6);
        return { monday, todayIndex: idx };
    }
    
    function renderCalendar() {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';
    
        const { monday, todayIndex } = getCurrentWeekInfo();
        if (activeDayIndex === null || activeDayIndex < 0 || activeDayIndex > 6) {
            activeDayIndex = todayIndex;
        }
    
        let totalWorkoutsDone = 0;
    
        // Подсчёт статистики за неделю и определение статуса дней
        const weekMeta = [];
        for (let i = 0; i < 7; i++) {
            const dayData = schedule[i];
            let hasWorkout = false;
            let totalSets = 0;
            let completedSets = 0;
            let icon = '➕';
            let title = 'День отдыха';
    
            if (dayData.workouts && dayData.workouts.length > 0) {
                hasWorkout = true;
                const firstWorkout = dayData.workouts[0];
                const prog = programs.find(p => p.id === firstWorkout.programId);
                if (prog) {
                    icon = prog.icon;
                    title = prog.name + (dayData.workouts.length > 1 ? ` +${dayData.workouts.length - 1}` : '');
                }
    
                dayData.workouts.forEach(w => {
                    const p = programs.find(pp => pp.id === w.programId);
                    if (p) {
                        p.exercises.forEach((ex, exIndex) => {
                            totalSets += getWorkoutExerciseSetCount(w, p, exIndex);
                        });
                        if (w.completedSets) {
                            completedSets += w.completedSets.length;
                        }
                    }
                });
            }
    
            const isDayComplete = totalSets > 0 && totalSets === completedSets;
            if (isDayComplete) totalWorkoutsDone++;
            weekMeta.push({ hasWorkout, totalSets, completedSets, icon, title, isDayComplete });
        }
    
        // Крупная карточка активного дня
        const mainIndex = activeDayIndex;
        const mainMeta = weekMeta[mainIndex];
        const mainCard = document.createElement('div');
        mainCard.className = 'day-card';
        if (mainMeta.hasWorkout) mainCard.classList.add('assigned');
        if (mainMeta.isDayComplete) mainCard.classList.add('completed');
        if (mainIndex === todayIndex) mainCard.classList.add('today');
        mainCard.onclick = () => openDayModal(mainIndex);
    
        const mainDate = new Date(monday.getTime() + mainIndex * 24 * 60 * 60 * 1000);
        const dayNum = mainDate.getDate();
        const monthNum = mainDate.getMonth() + 1;
        const dateStr = `${dayNum}.${monthNum.toString().padStart(2, '0')}`;
    
        const mainProgress = mainMeta.totalSets > 0
            ? `${mainMeta.completedSets}/${mainMeta.totalSets} подх.`
            : 'Нет тренировок';
    
        mainCard.innerHTML = `
            <div class="day-name">${DAYS[mainIndex]}</div>
            <div class="day-content">
                <div class="day-main-left">
                    <div class="day-date">${dateStr}</div>
                    <div class="day-title">${mainMeta.title}</div>
                    <div class="day-progress">
                        <span>${mainProgress}</span>
                    </div>
                </div>
                <div class="day-icon">${mainMeta.icon}</div>
            </div>
        `;
        grid.appendChild(mainCard);
    
        // Полоса недели снизу
        const weekBar = document.createElement('div');
        weekBar.className = 'calendar-week-bar';
    
        for (let i = 0; i < 7; i++) {
            const meta = weekMeta[i];
            const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
            const dn = d.getDate();
            const mn = d.getMonth() + 1;
            const chip = document.createElement('div');
            chip.className = 'week-chip';
            if (meta.hasWorkout) chip.classList.add('has-workout');
            if (meta.isDayComplete) chip.classList.add('completed');
            if (i === activeDayIndex) chip.classList.add('active');
            if (i === todayIndex) chip.classList.add('today');
    
            chip.innerHTML = `
                <div class="week-chip-day">${DAYS_SHORT[i]}</div>
                <div class="week-chip-date">${dn}.${mn.toString().padStart(2, '0')}</div>
                <div class="week-chip-dot"></div>
            `;
            chip.onclick = (e) => {
                e.stopPropagation();
                activeDayIndex = i;
                renderCalendar();
            };
            weekBar.appendChild(chip);
        }
        grid.appendChild(weekBar);
    
        const statsBar = document.getElementById('stats-bar');
        if (statsBar) {
            statsBar.innerHTML = `
                <div class="stat-chip active">Выполнено дней: ${totalWorkoutsDone}/7</div>
                <div class="stat-chip">Программ: ${programs.length}</div>
            `;
        }
    }

    function renderLibrary() {
        switchLibraryTab('user');
        renderProgramsList();
    }

    function switchLibraryTab(tab) {
        const userPanel   = document.getElementById('library-user-panel');
        const presetPanel = document.getElementById('library-preset-panel');
        const tabUser     = document.getElementById('library-tab-user');
        const tabPreset   = document.getElementById('library-tab-preset');

        if (!userPanel || !presetPanel || !tabUser || !tabPreset) return;

        const isUser = tab === 'user';
        userPanel.style.display   = isUser ? '' : 'none';
        presetPanel.style.display = isUser ? 'none' : '';

        tabUser.classList.toggle('active', isUser);
        tabPreset.classList.toggle('active', !isUser);
    }

    function deleteProgram(id) {
        const prog = programs.find(p => p.id === id);
        if (!prog) return;
        if (!confirm(`Удалить программу «${prog.name}»? Она также будет удалена из расписания.`)) return;

        // Удаляем из списка программ
        programs = programs.filter(p => p.id !== id);

        // Удаляем все тренировки с этой программой из расписания
        schedule = schedule.map(day => ({
            ...day,
            workouts: (day.workouts || []).filter(w => w.programId !== id)
        }));

        savePrograms();
        saveSchedule();

        renderProgramsList();
        renderCalendar();

        // Если открыт модал дня — перерисуем содержимое
        const modal = document.getElementById('day-modal');
        if (modal && modal.classList.contains('active') && currentDayIndex !== null) {
            renderDayContent();
        }
    }

    function editProgram(id) {
        const prog = programs.find(p => p.id === id);
        if (!prog) return;

        editingId = id;
        document.getElementById('form-title').textContent = '✏️ Редактирование: ' + prog.name;
        document.getElementById('save-btn').innerHTML = '<span>💾</span><span>Обновить программу</span>';
        document.getElementById('cancel-btn').style.display = 'flex';
        
        document.getElementById('prog-name').value = prog.name;
        selectedIcon = prog.icon;
        renderEmojiPicker();

        const container = document.getElementById('exercises-list');
        container.innerHTML = '';
        
        prog.exercises.forEach((ex, exIdx) => {
            const blockId = 'ex-block-edit-' + id + '-' + exIdx;
            const block = document.createElement('div');
            block.className = 'exercise-block';
            block.id = blockId;
            const exType = getExerciseType(ex);
            const meta = getTypeMeta(exType);
            
            let setsHtml = '';
            ex.sets.forEach((set, idx) => {
                if (exType === 'cardio') {
                    // Для кардио только одно поле - минуты
                    setsHtml += `
                        <div class="set-row">
                            <div class="set-number">${idx + 1}</div>
                            <input type="number" class="set-weight-input" placeholder="${meta.primaryPlaceholder}" min="${meta.primaryMin}" inputmode="numeric" value="${set.weight || ''}" onfocus="clearZeroInput(this)">
                            <button class="remove-set-btn" onclick="removeSetRow(this)">−</button>
                        </div>
                    `;
                } else {
                    // Для силовых - вес и повторения
                    setsHtml += `
                        <div class="set-row">
                            <div class="set-number">${idx + 1}</div>
                            <input type="number" class="set-weight-input" placeholder="${meta.primaryPlaceholder}" min="${meta.primaryMin}" inputmode="decimal" value="${set.weight || ''}" onfocus="clearZeroInput(this)">
                            <input type="number" class="set-reps-input" placeholder="${meta.secondaryPlaceholder}" min="${meta.secondaryMin}" inputmode="numeric" value="${set.reps || ''}" onfocus="clearZeroInput(this)">
                            <button class="remove-set-btn" onclick="removeSetRow(this)">−</button>
                        </div>
                    `;
                }
            });
            
            block.innerHTML = `
                <div class="exercise-header">
                    <input type="text" class="exercise-name-input" placeholder="Название упражнения" value="${ex.name.replace(/"/g, '&quot;')}">
                    <select class="exercise-type-select" onchange="updateSetInputsForType('${blockId}')">
                        <option value="strength" ${exType === 'strength' ? 'selected' : ''}>Силовое</option>
                        <option value="cardio" ${exType === 'cardio' ? 'selected' : ''}>Кардио</option>
                    </select>
                    <button class="remove-exercise-btn" onclick="this.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="sets-header">
                    <span class="sets-header-label">Подходы</span>
                    <button class="add-set-btn" onclick="addSetRow('${blockId}')">+ Добавить подход</button>
                </div>
                <div class="sets-container" id="sets-${blockId}">${setsHtml}</div>
            `;
            container.appendChild(block);
        });
        
        if (prog.exercises.length === 0) addExerciseBlock();

        // Переключаемся во вкладку "Программы" и прокручиваем к форме
        switchTab('create');
        const form = document.getElementById('form-title');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    let currentDayIndex = null;
    let editingSet = null;
    let workoutEditSnapshot = null;
    let pendingFinishWorkoutIndex = null;
    let expandedWorkoutIndex = null;

    function getWorkoutExerciseSetCount(workout, prog, exIndex) {
        const custom = workout?.exerciseSetCounts?.[exIndex];
        if (typeof custom === 'number' && custom >= 1) return custom;
        const base = prog?.exercises?.[exIndex]?.sets?.length;
        return typeof base === 'number' ? base : 0;
    }

    function isWorkoutFinished(workout) {
        return !!workout?.finishedAt;
    }

    function setSetOverrideValue(wIndex, exIndex, setIndex, field, rawValue) {
        const w = schedule[currentDayIndex].workouts[wIndex];
        if (!w) return;
        if (isWorkoutFinished(w)) return;
        if (!w.setOverrides) w.setOverrides = {};

        const setId = `${exIndex}-${setIndex}`;
        const curr  = w.setOverrides[setId] || { weight: '0', reps: '0' };
        const value = rawValue === '' || rawValue === null || rawValue === undefined ? '0' : String(rawValue);

        if ((field === 'weight' && curr.weight === value) || (field === 'reps' && curr.reps === value)) return;
        if (field === 'weight') curr.weight = value;
        if (field === 'reps')   curr.reps   = value;

        w.setOverrides[setId] = curr;
        saveSchedule();
    }

    function addExerciseSet(wIndex, exIndex) {
        const w = schedule[currentDayIndex].workouts[wIndex];
        const prog = programs.find(p => p.id === w?.programId);
        if (!w || !prog) return;
        if (isWorkoutFinished(w)) {
            showAlert('Тренировка уже завершена и доступна только для просмотра');
            return;
        }

        if (!w.exerciseSetCounts) w.exerciseSetCounts = [];
        if (typeof w.exerciseSetCounts[exIndex] !== 'number') {
            w.exerciseSetCounts[exIndex] = getWorkoutExerciseSetCount(w, prog, exIndex);
        }

        const currCount = getWorkoutExerciseSetCount(w, prog, exIndex);
        w.exerciseSetCounts[exIndex] = currCount + 1;

        // Next setId: current last index
        const newSetId = `${exIndex}-${currCount}`;
        if (!w.setOverrides) w.setOverrides = {};
        if (!w.setOverrides[newSetId]) w.setOverrides[newSetId] = { weight: '0', reps: '0' };

        saveSchedule();
        renderDayContent();
    }

    function removeExerciseSet(wIndex, exIndex) {
        const w = schedule[currentDayIndex].workouts[wIndex];
        const prog = programs.find(p => p.id === w?.programId);
        if (!w || !prog) return;
        if (isWorkoutFinished(w)) {
            showAlert('Тренировка уже завершена и доступна только для просмотра');
            return;
        }
        if (!w.exerciseSetCounts) w.exerciseSetCounts = [];

        const currCount = getWorkoutExerciseSetCount(w, prog, exIndex);
        if (currCount <= 1) return;

        const newCount = currCount - 1;
        w.exerciseSetCounts[exIndex] = newCount;

        // Remove only the tail set(s) that no longer exist
        const completed = w.completedSets || [];
        if (!w.completedSets) w.completedSets = completed;
        if (!w.setOverrides) w.setOverrides = {};

        for (let si = newCount; si < currCount; si++) {
            const setId = `${exIndex}-${si}`;
            const pos = w.completedSets.indexOf(setId);
            if (pos !== -1) w.completedSets.splice(pos, 1);
            if (w.setOverrides && w.setOverrides[setId]) delete w.setOverrides[setId];
        }

        saveSchedule();
        renderDayContent();
    }

    function openDayModal(index) {
        currentDayIndex = index;
        expandedWorkoutIndex = null;
        const modal = document.getElementById('day-modal');
        const title = document.getElementById('modal-day-title');
        
        title.textContent = DAYS[index];
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        switchModalTab('workouts');
    }
    
    function switchModalTab(tabName) {
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        document.querySelectorAll('.modal-tab')[0].classList.add('active');
        document.getElementById('tab-workouts').classList.add('active');
        renderDayContent();
    }

    function renderDayContent() {
        const dayData = schedule[currentDayIndex];
        const workoutsList = document.getElementById('day-workouts-list');
        const statsDiv = document.getElementById('modal-day-stats');
        const programById = Object.fromEntries((programs || []).map(p => [p.id, p]));
        let totalVolume = 0;
        let totalCompletedSets = 0;
        
        if (dayData.workouts) {
            dayData.workouts.forEach(w => {
                const prog = programById[w.programId];
                if (prog) {
                    const completedSet = new Set(w.completedSets || []);
                    const overrides = w.setOverrides || {};
                    prog.exercises.forEach((ex, exIdx) => {
                        const exType = getExerciseType(ex);
                        const setCount = getWorkoutExerciseSetCount(w, prog, exIdx);
                        for (let setIdx = 0; setIdx < setCount; setIdx++) {
                            const setId = `${exIdx}-${setIdx}`;
                            if (completedSet.has(setId)) {
                                const baseSet = ex.sets?.[setIdx];
                                let weight = parseFloat(baseSet?.weight) || 0;
                                if (overrides[setId]) {
                                    weight = parseFloat(overrides[setId].weight) || weight;
                                }
                                if (exType === 'strength') totalVolume += weight;
                                totalCompletedSets++;
                            }
                        }
                    });
                }
            });
        }
        
        statsDiv.innerHTML = `
            <div class="stat-badge">⚖️ ${totalVolume} кг</div>
            <div class="stat-badge">✓ ${totalCompletedSets} подх.</div>
        `;

        workoutsList.innerHTML = '';
        if (dayData.workouts.length === 0) {
            workoutsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏋️</div><p>Нет тренировок</p></div>';
        } else {
            if (expandedWorkoutIndex === null || expandedWorkoutIndex < 0 || expandedWorkoutIndex >= dayData.workouts.length) {
                expandedWorkoutIndex = 0;
            }
            dayData.workouts.forEach((w, wIndex) => {
                const prog = programById[w.programId];
                if (!prog) return;
                const isFinished = isWorkoutFinished(w);
                const isExpanded = expandedWorkoutIndex === wIndex;
                const completedSet = new Set(w.completedSets || []);
                const overrides = w.setOverrides || {};

                const wDiv = document.createElement('div');
                wDiv.className = 'workout-exercise-block';
                
                const editingWorkout = editingSet && editingSet.workoutIndex === wIndex && editingSet.bulkMode;
                let html = `
                    <div class="workout-exercise-header">
                        <div class="workout-exercise-title">${prog.icon} ${prog.name} ${isFinished ? '<span class="workout-exercise-counter">Завершена · только просмотр</span>' : ''}</div>
                        <div style="display:flex;gap:6px;">
                            ${isFinished && !editingWorkout ? `<button class="btn btn-secondary btn-small" onclick="toggleWorkoutExpanded(${wIndex})">${isExpanded ? '▾ Свернуть' : '▸ Открыть'}</button>` : ''}
                            ${editingWorkout
                                ? `<button class="btn btn-secondary btn-small workout-confirm-action" onclick="saveWorkoutEdit(${wIndex})" title="Подтвердить изменения">✓</button>
                                   <button class="btn btn-danger btn-small workout-cancel-action" onclick="cancelWorkoutEdit(${wIndex})" title="Отменить редактирование">✕</button>`
                                : `${isFinished
                                    ? `<button class="btn btn-secondary btn-small" disabled title="Тренировка уже завершена">✔ Завершена</button>`
                                    : `<button class="btn btn-secondary btn-small workout-edit-action" onclick="editWorkoutInDay(${wIndex})">✏️ Редактировать</button>
                                       <button class="btn btn-secondary btn-small workout-finish-action" onclick="openFinishConfirmModal(${wIndex})" title="Завершить тренировку">✅ Завершить тренировку</button>`
                                }`
                            }
                            ${editingWorkout ? '' : `<button class="btn btn-danger btn-small" onclick="removeWorkoutFromDay(${wIndex})">×</button>`}
                        </div>
                    </div>
                `;
                if (isFinished && !isExpanded) {
                    wDiv.innerHTML = html;
                    workoutsList.appendChild(wDiv);
                    return;
                }

                prog.exercises.forEach((ex, exIndex) => {
                    const exType = getExerciseType(ex);
                    const meta = getTypeMeta(exType);
                    const setCount = getWorkoutExerciseSetCount(w, prog, exIndex);

                    let completedCount = 0;
                    let setsHtml = '';

                    for (let setIndex = 0; setIndex < setCount; setIndex++) {
                        const setId = `${exIndex}-${setIndex}`;
                        const isChecked = completedSet.has(setId);
                        const visualChecked = isFinished ? true : isChecked;
                        if (isChecked) completedCount++;

                        const baseSet = ex.sets?.[setIndex];
                        let displayWeight = baseSet?.weight || '0';
                        let displayReps = baseSet?.reps || '0';

                        if (overrides[setId]) {
                            displayWeight = overrides[setId].weight || displayWeight;
                            displayReps = overrides[setId].reps || displayReps;
                        }

                        if (editingWorkout && !isFinished) {
                            setsHtml += `
                                <div class="workout-set-item editing ${isChecked ? 'completed' : ''}">
                                    <div class="checkbox ${isChecked ? 'checked' : ''}" onclick="toggleSet(${wIndex}, ${exIndex}, ${setIndex})"></div>
                                    <div class="set-inputs">
                                        <div class="set-input-wrapper">
                                            <span class="set-input-label">${meta.primaryUnit}</span>
                                            <input type="number" class="set-input" id="edit-weight-${wIndex}-${exIndex}-${setIndex}" value="${displayWeight}" min="${meta.primaryMin}" inputmode="decimal" onfocus="clearZeroInput(this)" oninput="setSetOverrideValue(${wIndex}, ${exIndex}, ${setIndex}, 'weight', this.value)">
                                        </div>
                                        <div class="set-input-wrapper">
                                            <span class="set-input-label">${meta.secondaryUnit}</span>
                                            <input type="number" class="set-input" id="edit-reps-${wIndex}-${exIndex}-${setIndex}" value="${displayReps}" min="${meta.secondaryMin}" inputmode="numeric" onfocus="clearZeroInput(this)" oninput="setSetOverrideValue(${wIndex}, ${exIndex}, ${setIndex}, 'reps', this.value)">
                                        </div>
                                    </div>
                                    <div class="set-actions"></div>
                                </div>
                            `;
                        } else {
                            setsHtml += `
                                <div class="workout-set-item ${visualChecked ? 'completed' : ''}">
                                    <div class="checkbox ${visualChecked ? 'checked' : ''}" ${isFinished ? '' : `onclick="toggleSet(${wIndex}, ${exIndex}, ${setIndex})"`}></div>
                                    <div class="set-label" ${isFinished ? '' : `onclick="toggleSet(${wIndex}, ${exIndex}, ${setIndex})"`}>
                                        Подход ${setIndex + 1}
                                        <span>${displayWeight} ${meta.primaryUnit} × ${displayReps} ${meta.secondaryUnit}</span>
                                    </div>
                                    <div class="set-actions"></div>
                                </div>
                            `;
                        }
                    }

                    html += `
                        <div style="margin-bottom: 15px;">
                            <div class="workout-exercise-title" style="margin-bottom: 10px; font-size: 14px; justify-content:space-between;">
                                <div style="display:flex;flex-direction:column;gap:2px;">
                                    <div>${ex.name}</div>
                                    <span class="workout-exercise-counter">${completedCount}/${setCount} подх.</span>
                                </div>
                                <div style="display:flex;gap:6px;align-items:flex-start;">
                                    ${isFinished ? '' : `<button class="btn btn-secondary btn-small" onclick="addExerciseSet(${wIndex}, ${exIndex})" style="margin:0;">+ Подход</button>
                                    <button class="btn btn-secondary btn-small" onclick="removeExerciseSet(${wIndex}, ${exIndex})" style="margin:0;" ${setCount <= 1 ? 'disabled' : ''}>− Подход</button>`}
                                </div>
                            </div>
                            ${setsHtml}
                        </div>
                    `;
                });
                
                wDiv.innerHTML = html;
                workoutsList.appendChild(wDiv);
            });
        }

    }

    function startSetEdit(wIndex, exIndex, setIndex) {
        editingSet = { workoutIndex: wIndex, exerciseIndex: exIndex, setIndex: setIndex };
        renderDayContent();
    }

    function saveSetEdit(wIndex, exIndex, setIndex) {
        const weightInput = document.getElementById(`edit-weight-${wIndex}-${exIndex}-${setIndex}`);
        const repsInput   = document.getElementById(`edit-reps-${wIndex}-${exIndex}-${setIndex}`);
        
        const weight = weightInput ? weightInput.value || '0' : '0';
        const reps   = repsInput   ? repsInput.value   || '0' : '0';
        const setId  = `${exIndex}-${setIndex}`;
        
        if (!schedule[currentDayIndex].workouts[wIndex].setOverrides) {
            schedule[currentDayIndex].workouts[wIndex].setOverrides = {};
        }
        schedule[currentDayIndex].workouts[wIndex].setOverrides[setId] = { weight, reps };
        
        // Auto-advance to next set
        const wasBulk = editingSet && editingSet.bulkMode;
        const prog = programs.find(p => p.id === schedule[currentDayIndex].workouts[wIndex].programId);
        let nextSet = null;
        if (wasBulk && prog) {
            const exList = prog.exercises;
            let ei = exIndex, si = setIndex + 1;
            if (si >= exList[ei].sets.length) { ei++; si = 0; }
            if (ei < exList.length) {
                nextSet = { workoutIndex: wIndex, exerciseIndex: ei, setIndex: si, bulkMode: true };
            }
        }
        editingSet = nextSet;

        saveSchedule();
        renderDayContent();
        
        // Focus next input if advanced
        if (editingSet) {
            setTimeout(() => {
                const next = document.getElementById(`edit-weight-${wIndex}-${editingSet.exerciseIndex}-${editingSet.setIndex}`);
                if (next) next.focus();
            }, 50);
        } else {
            showAlert('Подходы сохранены! ✅', 'success');
        }
    }

    function cancelSetEdit() {
        editingSet = null;
        renderDayContent();
    }

    function editWorkoutInDay(wIndex) {
        const w = schedule[currentDayIndex].workouts[wIndex];
        if (isWorkoutFinished(w)) {
            showAlert('Завершенную тренировку нельзя редактировать');
            return;
        }
        // If already editing this workout — cancel
        if (editingSet && editingSet.workoutIndex === wIndex && editingSet.bulkMode) {
            cancelWorkoutEdit(wIndex);
            return;
        } else {
            // Bulk mode: open first incomplete set for editing, or first set if all done
            const prog = programs.find(p => p.id === w.programId);
            if (!prog) return;
            workoutEditSnapshot = {
                workoutIndex: wIndex,
                completedSets: Array.isArray(w.completedSets) ? [...w.completedSets] : [],
                setOverrides: JSON.parse(JSON.stringify(w.setOverrides || {})),
                exerciseSetCounts: Array.isArray(w.exerciseSetCounts) ? [...w.exerciseSetCounts] : []
            };
            // Find first set
            editingSet = { workoutIndex: wIndex, exerciseIndex: 0, setIndex: 0, bulkMode: true };
        }
        renderDayContent();
    }

    function saveWorkoutEdit(wIndex) {
        if (!editingSet || editingSet.workoutIndex !== wIndex || !editingSet.bulkMode) return;
        editingSet = null;
        workoutEditSnapshot = null;
        saveSchedule();
        renderDayContent();
        showAlert('Изменения сохранены ✅', 'success');
    }

    function cancelWorkoutEdit(wIndex) {
        const w = schedule[currentDayIndex]?.workouts?.[wIndex];
        if (!w) return;
        if (!workoutEditSnapshot || workoutEditSnapshot.workoutIndex !== wIndex) {
            editingSet = null;
            renderDayContent();
            return;
        }

        w.completedSets = [...(workoutEditSnapshot.completedSets || [])];
        w.setOverrides = JSON.parse(JSON.stringify(workoutEditSnapshot.setOverrides || {}));
        w.exerciseSetCounts = [...(workoutEditSnapshot.exerciseSetCounts || [])];
        editingSet = null;
        workoutEditSnapshot = null;
        saveSchedule();
        renderDayContent();
        showAlert('Редактирование отменено', 'info');
    }

    function openAddWorkoutSelector() {
        if (programs.length === 0) {
            showAlert('Сначала создайте программу во вкладке «Программы»');
            switchTab('create');
            return;
        }
        
        const workoutsList = document.getElementById('day-workouts-list');
        let html = '<p style="color:var(--text-secondary); margin-bottom:10px;">Выберите программу:</p>';
        
        programs.forEach(prog => {
            html += `
                <div class="program-card" onclick="addWorkoutToDay(${prog.id})">
                    <div class="program-icon">${prog.icon}</div>
                    <div class="program-info">
                        <div class="program-name">${prog.name}</div>
                        <div class="program-exercises">${prog.exercises.length} упражнений</div>
                    </div>
                    <div style="font-size: 20px; color: var(--text-secondary);">+</div>
                </div>
            `;
        });
        
        workoutsList.innerHTML = html + `<button class="btn btn-secondary" onclick="renderDayContent()" style="margin-top:10px;">Назад</button>`;
    }

    function addWorkoutToDay(progId) {
        const prog = programs.find(p => p.id === progId);
        const exerciseSetCounts = prog
            ? prog.exercises.map(ex => ex?.sets?.length || 0)
            : [];

        schedule[currentDayIndex].workouts.unshift({
            programId: progId,
            workoutId: Date.now() + Math.floor(Math.random() * 100000),
            completedSets: [],
            setOverrides: {},
            exerciseSetCounts,
            finishedAt: null
        });
        expandedWorkoutIndex = 0;
        editingSet = null;
        workoutEditSnapshot = null;
        saveSchedule();
        renderDayContent();
    }
    
    function removeWorkoutFromDay(wIndex) {
        if(confirm('Удалить эту тренировку из дня?')) {
            schedule[currentDayIndex].workouts.splice(wIndex, 1);
            if (expandedWorkoutIndex === wIndex) expandedWorkoutIndex = null;
            if (typeof expandedWorkoutIndex === 'number' && expandedWorkoutIndex > wIndex) expandedWorkoutIndex--;
            if (editingSet && editingSet.workoutIndex === wIndex) {
                editingSet = null;
                workoutEditSnapshot = null;
            }
            saveSchedule();
            renderDayContent();
            renderCalendar();
        }
    }

    function toggleWorkoutExpanded(wIndex) {
        if (expandedWorkoutIndex === wIndex) {
            expandedWorkoutIndex = null;
        } else {
            expandedWorkoutIndex = wIndex;
        }
        renderDayContent();
    }

    function openFinishConfirmModal(wIndex) {
        const w = schedule[currentDayIndex]?.workouts?.[wIndex];
        if (!w) return;
        if (isWorkoutFinished(w)) {
            showAlert('Эта тренировка уже завершена');
            return;
        }
        pendingFinishWorkoutIndex = wIndex;
        const modal = document.getElementById('finish-confirm-modal');
        if (modal) modal.classList.add('active');
    }

    function closeFinishConfirmModal(event) {
        if (event && event.target !== event.currentTarget) return;
        const modal = document.getElementById('finish-confirm-modal');
        if (modal) modal.classList.remove('active');
        pendingFinishWorkoutIndex = null;
    }

    function confirmFinishWorkout() {
        if (pendingFinishWorkoutIndex === null || pendingFinishWorkoutIndex === undefined) {
            closeFinishConfirmModal();
            return;
        }
        const wIndex = pendingFinishWorkoutIndex;
        closeFinishConfirmModal();
        finishWorkout(wIndex);
    }

    // Mark all unfinished sets as completed with zero values
    function finishWorkout(wIndex) {
        const dayWorkouts = schedule[currentDayIndex].workouts;
        const w    = dayWorkouts[wIndex];
        if (!w) return;
        if (isWorkoutFinished(w)) {
            showAlert('Эта тренировка уже завершена');
            return;
        }
        const prog = programs.find(p => p.id === w.programId);
        if (!prog) return;

        // Завершение тренировки должно закрывать режим редактирования подходов.
        if (editingSet && editingSet.workoutIndex === wIndex) {
            editingSet = null;
            workoutEditSnapshot = null;
        }

        if (!w.completedSets)  w.completedSets  = [];
        if (!w.setOverrides)   w.setOverrides   = {};
        const completed = new Set(w.completedSets);

        // Заполняем нулями только незаполненные по весу/повторам,
        // но НЕ отмечаем их завершёнными — считаем только реально отмеченные подходы.
        prog.exercises.forEach((ex, exIdx) => {
            const setCount = getWorkoutExerciseSetCount(w, prog, exIdx);
            for (let setIdx = 0; setIdx < setCount; setIdx++) {
                const setId = `${exIdx}-${setIdx}`;
                if (!w.setOverrides[setId]) {
                    const baseSet = ex.sets?.[setIdx];
                    w.setOverrides[setId] = {
                        weight: baseSet?.weight || '0',
                        reps:   baseSet?.reps   || '0'
                    };
                }
            }
        });
        w.completedSets = Array.from(completed);
        w.finishedAt = new Date().toISOString();

        // Завершённая тренировка уходит вниз списка и сворачивается.
        dayWorkouts.splice(wIndex, 1);
        dayWorkouts.push(w);
        expandedWorkoutIndex = dayWorkouts.length > 1 ? 0 : null;

        saveSchedule();
        renderDayContent();
        renderCalendar();
        showCelebration(prog, w);
        checkAchievements(); // Проверяем ачивки после каждой тренировки
        showAlert('Тренировка завершена ✅', 'success');
    }

    function toggleSet(wIndex, exIndex, setIndex) {
        const w = schedule[currentDayIndex].workouts[wIndex];
        if (!w || isWorkoutFinished(w)) return;
        if (!w.completedSets) w.completedSets = [];

        const setId = `${exIndex}-${setIndex}`;
        const pos = w.completedSets.indexOf(setId);
        
        if (pos === -1) {
            w.completedSets.push(setId);
            
            const prog = programs.find(p => p.id === w.programId);
            if (prog) {
                let totalSets = 0;
                prog.exercises.forEach((ex, exIndex) => {
                    totalSets += getWorkoutExerciseSetCount(w, prog, exIndex);
                });
                
                if (w.completedSets.length === totalSets) {
                    showCelebration(prog, w);
                }
            }
        } else {
            w.completedSets.splice(pos, 1);
        }
        saveSchedule();
        renderDayContent();
    }
    
    function showCelebration(prog, workoutData) {
        let strengthVolume = 0;
        let cardioMinutes = 0;
        let completedSetCount = 0;
        
        const completed = new Set(workoutData.completedSets || []);
        prog.exercises.forEach((ex, exIdx) => {
            const exType = getExerciseType(ex);
            const setCount = getWorkoutExerciseSetCount(workoutData, prog, exIdx);
            for (let setIdx = 0; setIdx < setCount; setIdx++) {
                const setId = `${exIdx}-${setIdx}`;
                if (!completed.has(setId)) continue;
                const baseSet = ex.sets?.[setIdx];
                const primaryValue = parseFloat(workoutData.setOverrides?.[setId]?.weight ?? baseSet?.weight ?? '0') || 0;

                if (exType === 'cardio') {
                    cardioMinutes += primaryValue;
                } else {
                    strengthVolume += primaryValue;
                }
                completedSetCount++;
            }
        });
        
        // Record to history for stats
        recordWorkoutToHistory(prog, workoutData);

        const loadParts = [];
        if (strengthVolume > 0) loadParts.push(`${Math.round(strengthVolume)} кг`);
        if (cardioMinutes > 0) {
            loadParts.push(`${Math.round(cardioMinutes)} мин кардио`);
        }

        document.getElementById('cel-volume').textContent = loadParts.length ? loadParts.join(' · ') : '0';
        document.getElementById('cel-sets').textContent = completedSetCount;
        document.getElementById('celebration-overlay').style.display = 'flex';
    }

    function closeModal() {
        const modal = document.getElementById('day-modal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        editingSet = null;
        closeFinishConfirmModal();
        renderCalendar();
    }

    function closeModalOnOverlay(event) {
        if (event.target === event.currentTarget) {
            closeModal();
        }
    }

    function saveScheduleToStorage() {
        saveSchedule();
    }

    function showAlert(message, type = 'info') {
        const div = document.createElement('div');
        div.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? 'var(--success)' : 'var(--primary)'};
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: slideDown 0.3s ease;
        `;
        div.textContent = message;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            div.style.transition = 'opacity 0.3s';
            setTimeout(() => div.remove(), 300);
        }, 2000);
    }

    window.onpopstate = function() {
        const modal = document.getElementById('day-modal');
        if (modal.classList.contains('active')) {
            closeModal();
        }
    };

    // ═══════════════════════════════════════════════════════
    //  PROFILE & STATS
    // ═══════════════════════════════════════════════════════
    let userProfile = {};   // { gender, age, height, weight, activity }
    let activePeriod = 30;
    let chartVolume = null, chartSets = null, chartFreq = null;
    const profileStatsDom = {
        empty: null,
        chartsWrap: null,
        summaryCard: null,
        firstChartLabel: null,
        secondChartLabel: null,
        chartVolumeEl: null,
        chartSetsEl: null,
        chartFreqEl: null
    };

    function getProfileStatsDom() {
        if (!profileStatsDom.empty) {
            profileStatsDom.empty = document.getElementById('stats-empty');
            profileStatsDom.chartsWrap = document.getElementById('charts-wrap');
            profileStatsDom.summaryCard = document.getElementById('summary-card');
            profileStatsDom.firstChartLabel = document.querySelector('#charts-wrap .chart-block:nth-child(1) .chart-label');
            profileStatsDom.secondChartLabel = document.querySelector('#charts-wrap .chart-block:nth-child(2) .chart-label');
            profileStatsDom.chartVolumeEl = document.getElementById('chart-volume');
            profileStatsDom.chartSetsEl = document.getElementById('chart-sets');
            profileStatsDom.chartFreqEl = document.getElementById('chart-freq');
        }
        return profileStatsDom;
    }

    // ── TDEE calculation (Mifflin-St Jeor) ───────────────
    function calcTDEE(profile) {
        const { gender, age, height, weight, activity } = profile;
        if (!height || !weight || !age) return null;
        // BMR
        let bmr;
        if (gender === 'female') {
            bmr = 10 * weight + 6.25 * height - 5 * age - 161;
        } else {
            // male or unset — use male formula as default
            bmr = 10 * weight + 6.25 * height - 5 * age + 5;
        }
        const factor = activity || 1.375; // default: light activity
        return Math.round(bmr * factor);
    }

    // ── Save/load profile ─────────────────────────────────
    function saveProfile() {
        userProfile = {
            gender:       userProfile.gender   || null,
            activity:     userProfile.activity || null,
            age:          parseFloat(document.getElementById('profile-age').value)           || null,
            height:       parseFloat(document.getElementById('profile-height').value)        || null,
            weight:       parseFloat(document.getElementById('profile-weight').value)        || null,
        };
        renderHealthMetrics();
        scheduleSync();
    }

    function setActivity(val) {
        userProfile.activity = val;
        document.querySelectorAll('.activity-btn').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.val) === val);
        });
        renderHealthMetrics();
        scheduleSync();
    }

    function setGender(g) {
        userProfile.gender = g;
        document.getElementById('gender-m').classList.toggle('active', g === 'male');
        document.getElementById('gender-f').classList.toggle('active', g === 'female');
        renderHealthMetrics();
        scheduleSync();
    }

    function loadProfileUI() {
        if (!userProfile) userProfile = {};
        if (userProfile.gender)   setGender(userProfile.gender);
        if (userProfile.activity) setActivity(userProfile.activity);
        const usernameEl = document.getElementById('profile-username');
        if (usernameEl) usernameEl.textContent = currentUsername || 'Пользователь';
        document.getElementById('profile-age').value           = userProfile.age          || '';
        document.getElementById('profile-height').value        = userProfile.height       || '';
        document.getElementById('profile-weight').value        = userProfile.weight       || '';
        renderHealthMetrics();
    }

    // ── Health metrics ────────────────────────────────────
    function renderHealthMetrics() {
        const { gender, age, height, weight } = userProfile;
        if (!height || !weight) {
            document.getElementById('health-card').style.display = 'none';
            return;
        }
        document.getElementById('health-card').style.display = '';

        const hm  = height / 100;
        const bmi = weight / (hm * hm);

        let bmiLabel, bmiClass;
        if      (bmi < 18.5) { bmiLabel = 'Недостаток веса'; bmiClass = 'warn';   }
        else if (bmi < 25)   { bmiLabel = 'Норма ✓';          bmiClass = 'good';   }
        else if (bmi < 30)   { bmiLabel = 'Избыток веса';     bmiClass = 'warn';   }
        else                 { bmiLabel = 'Ожирение';          bmiClass = 'danger'; }

        // Ideal weight: Devine formula
        let idealMin = 0, idealMax = 0;
        if (gender === 'male') {
            const base = 50 + 2.3 * ((height - 152.4) / 2.54);
            idealMin = Math.round(base * 0.9); idealMax = Math.round(base * 1.1);
        } else {
            const base = 45.5 + 2.3 * ((height - 152.4) / 2.54);
            idealMin = Math.round(base * 0.9); idealMax = Math.round(base * 1.1);
        }
        const idealStr   = height < 152.4 ? `~${Math.round(weight)} кг` : `${idealMin}–${idealMax} кг`;
        const idealDiff  = weight - ((idealMin + idealMax) / 2);
        const idealClass = Math.abs(idealDiff) < 5 ? 'good' : Math.abs(idealDiff) < 15 ? 'warn' : 'danger';
        const idealNote  = Math.abs(idealDiff) < 5 ? 'В норме ✓'
            : idealDiff > 0 ? `+${Math.round(idealDiff)} кг выше нормы`
            : `${Math.round(Math.abs(idealDiff))} кг ниже нормы`;

        // TDEE
        const tdee = calcTDEE(userProfile);
        const tdeeHtml = tdee ? `
            <div class="health-metric wide">
                <div class="health-metric-val">${tdee.toLocaleString('ru')} ккал</div>
                <div class="health-metric-label">TDEE — суточная норма калорий</div>
                <div class="health-metric-note good">Справочный показатель ✓</div>
            </div>` : '';

        document.getElementById('health-metrics').innerHTML = `
            <div class="health-metric">
                <div class="health-metric-val">${bmi.toFixed(1)}</div>
                <div class="health-metric-label">Индекс массы тела (BMI)</div>
                <div class="health-metric-note ${bmiClass}">${bmiLabel}</div>
            </div>
            <div class="health-metric">
                <div class="health-metric-val">${idealStr}</div>
                <div class="health-metric-label">Идеальный вес</div>
                <div class="health-metric-note ${idealClass}">${idealNote}</div>
            </div>
            ${tdeeHtml}
            <div class="health-metric wide" style="border-left-color:var(--border-strong);">
                <div class="health-metric-label" style="font-size:10px;line-height:1.45;color:var(--text-2);">
                    Справка носит исключительно рекомендательный характер и основывается на расчетных формулах.
                </div>
            </div>
        `;
    }

    // ── Record workout to history ─────────────────────────
    function recordWorkoutToHistory(prog, workoutData) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const workoutKey = workoutData?.workoutId || workoutData?.finishedAt || `${prog.id}-${today}`;
        const completed = new Set(workoutData.completedSets || []);
        const exercises = prog.exercises.map((ex, exIdx) => {
            const exType = getExerciseType(ex);
            const setCount = getWorkoutExerciseSetCount(workoutData, prog, exIdx);
            const completedSets = [];

            for (let setIdx = 0; setIdx < setCount; setIdx++) {
                const setId = `${exIdx}-${setIdx}`;
                if (!completed.has(setId)) continue;

                const baseSet = ex.sets?.[setIdx];
                const weight = workoutData.setOverrides?.[setId]?.weight ?? baseSet?.weight ?? '0';
                const reps   = workoutData.setOverrides?.[setId]?.reps   ?? baseSet?.reps   ?? '0';
                completedSets.push({ weight: parseFloat(weight) || 0, reps: parseFloat(reps) || 0 });
            }

            return completedSets.length ? { name: ex.name, type: exType, sets: completedSets } : null;
        }).filter(Boolean);

        if (!exercises.length) return;

        // Avoid duplicates for the same finished workout instance
        workoutHistory = workoutHistory.filter(
            h => h.workoutKey !== workoutKey
        );
        workoutHistory.push({
            date: today,
            programId: prog.id,
            workoutKey,
            programName: prog.name,
            exercises
        });
        scheduleSync();
    }

    // ── Period selector ───────────────────────────────────
    function setPeriod(days) {
        activePeriod = days;
        ['30','7','all'].forEach(k => {
            document.getElementById('period-' + k).classList.remove('active');
        });
        document.getElementById(days === 30 ? 'period-30' : days === 7 ? 'period-7' : 'period-all')
            .classList.add('active');
        renderCharts();
    }

    function getFilteredHistory() {
        if (activePeriod === 0) return workoutHistory;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - activePeriod);
        const cutStr = cutoff.toISOString().slice(0, 10);
        return workoutHistory.filter(h => h.date >= cutStr);
    }

    // ── Charts ────────────────────────────────────────────
    function renderCharts() {
        const statsDom = getProfileStatsDom();
        const filtered = getFilteredHistory();
        const workoutEntries = filtered;

        const hasWorkouts = workoutEntries.length > 0;

        if (!hasWorkouts) {
            statsDom.empty.style.display = '';
            statsDom.chartsWrap.style.display = 'none';
            statsDom.summaryCard.style.display = 'none';
            return;
        }
        statsDom.empty.style.display = 'none';
        statsDom.chartsWrap.style.display = '';
        statsDom.summaryCard.style.display = '';

        const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#6366f1';
        const successColor = '#10b981';
        const warnColor    = '#f59e0b';
        const gridColor    = 'rgba(255,255,255,0.06)';
        const textColor    = '#a1a1aa';

        const baseOptions = (showLegend = false) => ({
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: showLegend, labels: { color: textColor, font: { size: 10 } } } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
                y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
            }
        });

        const byDate = {};
        workoutEntries.forEach(h => {
            if (!byDate[h.date]) byDate[h.date] = { strengthVolume: 0, cardioMinutes: 0, sets: 0 };
            h.exercises.forEach(ex => {
                const exType = normalizeExerciseType(ex.type);
                ex.sets.forEach(s => {
                    if (exType === 'cardio') {
                        byDate[h.date].cardioMinutes += Number(s.weight) || 0;
                    } else {
                        byDate[h.date].strengthVolume += Number(s.weight) || 0;
                    }
                    byDate[h.date].sets += 1;
                });
            });
        });
        const dates   = Object.keys(byDate).sort();
        const labels  = dates.map(d => { const [,m,day]=d.split('-'); return `${parseInt(day)}.${parseInt(m)}`; });
        const strengthVolumes = dates.map(d => Math.round(byDate[d].strengthVolume));
        const cardioDurations = dates.map(d => Math.round(byDate[d].cardioMinutes));
        const sets    = dates.map(d => byDate[d].sets);
        const hasStrengthData = strengthVolumes.some(v => v > 0);
        const hasCardioTimeData = cardioDurations.some(v => v > 0);
        const firstChartLabel = statsDom.firstChartLabel;
        const secondChartLabel = statsDom.secondChartLabel;
        if (firstChartLabel) {
            firstChartLabel.textContent = hasStrengthData && hasCardioTimeData
                ? '🏋️ Силовой объем + кардио минуты (в день)'
                : hasStrengthData
                    ? '🏋️ Поднятый вес (кг/день)'
                    : '🏃 Кардио минуты (в день)';
        }
        if (secondChartLabel) {
            secondChartLabel.textContent = hasCardioTimeData
                ? '🔢 Подходов и кардио-минут в день'
                : '🔢 Подходов в день';
        }

        if (chartVolume) chartVolume.destroy();
        const chartVolumeDatasets = [];
        if (hasStrengthData) {
            chartVolumeDatasets.push({
                label: 'Силовой объем (кг)',
                data: strengthVolumes,
                backgroundColor: primaryColor+'99',
                borderColor: primaryColor,
                borderWidth: 2,
                borderRadius: 6,
                type: 'bar'
            });
        }
        if (hasCardioTimeData || !hasStrengthData) {
            chartVolumeDatasets.push({
                label: 'Кардио минуты',
                data: cardioDurations,
                borderColor: '#06b6d4',
                backgroundColor: '#06b6d422',
                borderWidth: 2,
                pointRadius: 3,
                fill: false,
                tension: 0.25,
                type: hasStrengthData ? 'line' : 'bar'
            });
        }
        chartVolume = new Chart(statsDom.chartVolumeEl, {
            type: 'bar',
            data: { labels, datasets: chartVolumeDatasets },
            options: baseOptions(chartVolumeDatasets.length > 1)
        });

        if (chartSets) chartSets.destroy();
        const chartSetsDatasets = [{
            label: 'Подходы',
            data: sets,
            borderColor: successColor,
            backgroundColor: successColor+'22',
            borderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3
        }];
        if (hasCardioTimeData) {
            chartSetsDatasets.push({
                label: 'Кардио минуты',
                data: cardioDurations,
                borderColor: '#22d3ee',
                backgroundColor: '#22d3ee22',
                borderWidth: 2,
                pointRadius: 3,
                fill: false,
                tension: 0.3
            });
        }
        chartSets = new Chart(statsDom.chartSetsEl, {
            type: 'line',
            data: { labels, datasets: chartSetsDatasets },
            options: baseOptions(chartSetsDatasets.length > 1)
        });

        if (chartFreq) chartFreq.destroy();
        chartFreq = new Chart(statsDom.chartFreqEl, {
            type: 'bar',
            data: { labels, datasets: [{ data: dates.map(()=>1),
                backgroundColor: warnColor+'bb', borderColor: warnColor, borderWidth:2, borderRadius:6 }] },
            options: { ...baseOptions(), scales: {
                x: { ticks:{color:textColor,font:{size:10}}, grid:{color:gridColor} },
                y: { display: false }
            }}
        });

        const totalStrengthVolume = strengthVolumes.reduce((a,b)=>a+b,0);
        const totalCardioMinutes = cardioDurations.reduce((a,b)=>a+b,0);
        const totalSets     = sets.reduce((a,b)=>a+b,0);
        const totalWorkouts = workoutEntries.length;
        document.getElementById('summary-grid').innerHTML = `
            <div class="summary-stat">
                <div class="summary-stat-val">${totalStrengthVolume.toLocaleString('ru')}</div>
                <div class="summary-stat-label">кг поднято (сил.)</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-val">${totalCardioMinutes}</div>
                <div class="summary-stat-label">минут кардио</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-val">${totalSets}</div>
                <div class="summary-stat-label">подходов</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-val">${dates.length}</div>
                <div class="summary-stat-label">тренировочных дней</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-val">${totalWorkouts}</div>
                <div class="summary-stat-label">тренировок</div>
            </div>
        `;
    }

    function resetStats() {
        if (!confirm('вы уверены? Все данные будут утеряны')) return;
        workoutHistory = [];

        if (chartVolume) { chartVolume.destroy(); chartVolume = null; }
        if (chartSets)   { chartSets.destroy();   chartSets   = null; }
        if (chartFreq)   { chartFreq.destroy();   chartFreq   = null; }

        const summaryGrid = document.getElementById('summary-grid');
        if (summaryGrid) summaryGrid.innerHTML = '';

        scheduleSync();
        renderCharts();
        showAlert('Статистика сброшена ✅', 'success');
    }

    // ── CSV Export ────────────────────────────────────────
    function exportCSV() {
        if (!workoutHistory.length) {
            showAlert('Нет данных для экспорта');
            return;
        }
        const rows = [['Дата','Программа','Упражнение','Подход','Показатель 1','Показатель 2']];
        workoutHistory.slice().sort((a,b) => a.date.localeCompare(b.date))
            .forEach(h => {
                h.exercises.forEach(ex => {
                    ex.sets.forEach((s, i) => {
                        rows.push([h.date, h.programName, ex.name, i+1, s.weight, s.reps]);
                    });
                });
            });
        const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `fittrack_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showAlert('CSV скачан! ✅', 'success');
    }

    // ── Programs Export/Import ────────────────────────────
    function exportSingleProgram(programId) {
        const program = programs.find(p => p.id === programId);
        if (!program) {
            showAlert('Программа не найдена');
            return;
        }

        try {
            // Создаем объект для экспорта
            const exportData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                programsCount: 1,
                programs: [{
                    id: program.id,
                    name: program.name,
                    icon: program.icon,
                    exercises: program.exercises.map(ex => ({
                        name: ex.name,
                        type: ex.type || 'strength',
                        sets: ex.sets
                    }))
                }]
            };

            // Создаем JSON файл
            const json = JSON.stringify(exportData, null, 2);
            const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `program_${program.name.replace(/\s+/g, '_')}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showAlert(`Программа "${program.name}" экспортирована ✅`, 'success');
        } catch (e) {
            console.error('Export error:', e);
            showAlert('Ошибка при экспорте: ' + e.message);
        }
    }

    async function importPrograms(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Reset file input so same file can be selected again
        event.target.value = '';

        if (!file.name.endsWith('.json')) {
            showAlert('Пожалуйста, выберите JSON файл');
            return;
        }

        try {
            const text = await file.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                throw new Error('Ошибка чтения файла: неверный формат JSON');
            }

            console.log('Importing data:', data);

            // Validate structure - поддерживаем как формат с одной программой, так и с несколькими
            let programsToImport = [];
            
            if (data.programs && Array.isArray(data.programs)) {
                programsToImport = data.programs;
            } else if (data.name && data.exercises) {
                // Формат с одной программой без обертки
                programsToImport = [data];
            } else {
                throw new Error('Неверный формат файла. Ожидался файл программы FitTrack.');
            }

            console.log('Programs to import:', programsToImport);

            if (programsToImport.length === 0) {
                showAlert('Файл не содержит программ');
                return;
            }

            // Валидируем структуру каждой программы
            for (const prog of programsToImport) {
                if (!prog.name || !prog.exercises || !Array.isArray(prog.exercises)) {
                    throw new Error('Неверная структура программы: ' + (prog.name || 'без названия'));
                }
                for (const ex of prog.exercises) {
                    if (!ex.name || !ex.sets || !Array.isArray(ex.sets)) {
                        throw new Error('Неверная структура упражнения в программе: ' + prog.name);
                    }
                }
            }

            // Confirm import
            const confirmMsg = programsToImport.length === 1 
                ? `Импортировать программу "${programsToImport[0].name}"?`
                : `Импортировать ${programsToImport.length} программ?`;
            
            if (!confirm(confirmMsg + '\n\nПрограммы будут добавлены к вашим существующим.')) {
                return;
            }

            const payload = { programs: programsToImport };
            console.log('Sending to server:', payload);

            const response = await fetch(API + '/programs/import', {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify(payload)
            });

            console.log('Response status:', response.status);
            const result = await response.json();
            console.log('Response data:', result);

            if (!response.ok) {
                throw new Error(result.error || 'Ошибка импорта');
            }

            // Reload data from server
            await loadDataFromServer();
            renderLibrary();
            renderCalendar();

            showAlert(result.message || `Импортировано ${result.importedCount} программ ✅`, 'success');
        } catch (e) {
            console.error('Import error:', e);
            showAlert('Ошибка при импорте: ' + e.message);
        }
    }
