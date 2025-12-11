const app = {
    data: {
        manifest: null,
        currentQuiz: null,
        userAnswers: {},
        currentQuestionIndex: 0,
        isAnimating: false,
        cache: {},
        // KILL SWITCH : Permet d'annuler les chargements en cours si on change de quiz
        abortController: null,
        timerInterval: null
    },

    init: async () => {
        const loader = document.getElementById('app-loader');
        if(loader) loader.classList.remove('hidden');

        try {
            const response = await fetch('quizzes/index.json');
            if (!response.ok) throw new Error("Impossible de charger le manifeste (index.json)");
            app.data.manifest = await response.json();
            app.renderSidebar();
        } catch (e) {
            console.error(e);
            alert("Erreur critique : Impossible de lire 'quizzes/index.json'.");
        } finally {
            if(loader) loader.classList.add('hidden');
        }
    },

    // --- Navigation ---
    showView: (viewId) => {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        document.getElementById('app-content').scrollTop = 0;
    },

    showHome: () => {
        if (app.data.timerInterval) clearInterval(app.data.timerInterval);
        app.showView('view-home');
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
        app.renderSavedCustom();
    },

    showFinalSelector: () => {
        const container = document.getElementById('final-exam-list-container');
        container.innerHTML = '';

        app.data.manifest.finalExams.forEach(exam => {
            const card = document.createElement('div');
            card.className = 'exam-card';
            card.innerHTML = `
                <h3>${exam.title}</h3>
                <p>${exam.description || "Aucune description."}</p>
                <small>Cliquez pour commencer</small>
            `;
            card.onclick = () => app.prepareQuiz(exam.id, 'Final Exam');
            container.appendChild(card);
        });

        app.showView('view-final-selection');
    },

    showCustomBuilder: () => {
        app.renderCustomBuilder();
        app.showView('view-custom-builder');
    },

    // --- Sidebar & UI ---
    renderSidebar: () => {
        const createItem = (item, type, isDeletable = false) => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.innerHTML = `<div><strong>${item.title}</strong><br><small>${type}</small></div>`;
            div.onclick = () => app.prepareQuiz(item.id, type, div);

            if (isDeletable) {
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn';
                delBtn.innerHTML = '&times;';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(confirm("Supprimer ?")) app.deleteCustomQuiz(item.id);
                };
                div.appendChild(delBtn);
            }
            return div;
        };

        const fill = (id, list, type) => {
            const c = document.getElementById(id);
            c.innerHTML = '';
            if(list) list.forEach(x => c.appendChild(createItem(x, type)));
        };

        fill('list-modules', app.data.manifest.modules, 'Module');
        fill('list-checkpoints', app.data.manifest.checkpoints, 'Checkpoint');
        
        const finalC = document.getElementById('list-final');
        finalC.innerHTML = '';
        if (app.data.manifest.finalExams && app.data.manifest.finalExams.length > 0) {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.innerHTML = `<div><strong>Accéder aux Examens</strong><br><small>Sélection</small></div>`;
            
            div.onclick = () => {
                document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                app.showFinalSelector();
            };
            finalC.appendChild(div);
        }
        app.renderSavedCustom();
    },

    renderSavedCustom: () => {
        const c = document.getElementById('list-saved');
        const saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        c.innerHTML = '';
        if (saved.length === 0) {
            c.innerHTML = '<p class="empty-msg" style="padding:0.5rem; color:#888;">Vide.</p>';
            return;
        }
        saved.forEach(q => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.borderLeft = '3px solid #9b59b6';
            div.innerHTML = `<div><strong>${q.title}</strong><br><small>${q.questions.length} Qs</small></div>`;
            div.onclick = () => {
                document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                app.loadInMemoryQuiz(q);
            };
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.innerHTML = '&times;';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if(confirm("Supprimer ?")) app.deleteCustomQuiz(q.id);
            };
            div.appendChild(delBtn);
            c.appendChild(div);
        });
    },

    deleteCustomQuiz: (id) => {
        let saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        saved = saved.filter(q => q.id !== id);
        localStorage.setItem('customQuizzes', JSON.stringify(saved));
        app.renderSavedCustom();
    },

    // --- LE CŒUR DU SYSTÈME (Optimisé) ---

    // 1. Fetch avec gestion d'annulation (Signal) et Retry
    fetchJson: async (url, signal, retries = 2) => {
        // Cache Check
        if (app.data.cache[url]) return JSON.parse(JSON.stringify(app.data.cache[url]));

        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(`quizzes/${url}`, { signal }); 
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                app.data.cache[url] = data; // Save to cache
                return data;
            } catch (err) {
                if (err.name === 'AbortError') throw err; // Si annulé par l'utilisateur, on arrête tout
                if (i === retries) throw err; // Si dernière tentative échouée, on renvoie l'erreur
            }
        }
    },

    // 2. Préparation avec Kill Switch
    prepareQuiz: async (id, type, domElement) => {
        // A. ANNULATION DE LA PRÉCÉDENTE REQUÊTE
        if (app.data.abortController) {
            app.data.abortController.abort();
        }
        // Création d'un nouveau contrôleur pour cette requête
        app.data.abortController = new AbortController();
        const signal = app.data.abortController.signal;

        // B. Interface UI
        const loader = document.getElementById('app-loader');
        if(loader) loader.classList.remove('hidden');
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
        if (domElement) domElement.classList.add('active');

        try {
            let quizData = null;
            let item = null;

            if (type === 'Module') {
                item = app.data.manifest.modules.find(m => m.id === id);
                quizData = await app.fetchJson(item.file, signal);
            } 
            else if (type === 'Checkpoint') {
                item = app.data.manifest.checkpoints.find(c => c.id === id);
                quizData = await app.fetchJson(item.file, signal);
                if (!quizData.questions || quizData.questions.length === 0) {
                    quizData = await app.generateQuestionsFromRange(quizData, item.moduleRange, signal);
                }
            } 
            else if (type === 'Final Exam') {
                item = app.data.manifest.finalExams.find(f => f.id === id);
                quizData = await app.fetchJson(item.file, signal);
                if (!quizData.questions || quizData.questions.length === 0) {
                    quizData = await app.generateQuestionsFromRange(quizData, [1, 27], signal);
                }
                quizData.timeLimit = 75;
            }

            if (quizData && !signal.aborted) {
                app.loadInMemoryQuiz(quizData);
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("Chargement annulé par l'utilisateur (changement de quiz).");
            } else {
                console.error("Erreur chargement:", error);
                alert("Erreur: Le fichier JSON semble corrompu ou introuvable.\n" + error.message);
            }
        } finally {
            // Ne cacher le loader que si ce n'est pas une annulation (car une autre requête a pris le relais)
            if (!signal.aborted && loader) loader.classList.add('hidden');
        }
    },

    // 3. Génération Massive (Batching + Signal)
    generateQuestionsFromRange: async (baseQuiz, range, signal) => {
        const [start, end] = range;
        let pool = [];
        
        const modules = app.data.manifest.modules.filter(m => m.moduleNumber >= start && m.moduleNumber <= end);
        
        // Batch size : 5 requêtes simultanées max
        const batchSize = 5;
        
        for (let i = 0; i < modules.length; i += batchSize) {
            if (signal.aborted) throw new Error('AbortError'); // Stop si annulé

            const batch = modules.slice(i, i + batchSize);
            const promises = batch.map(m => 
                app.fetchJson(m.file, signal)
                    .then(data => data.questions || [])
                    .catch(() => []) // Ignore les erreurs individuelles de fichiers manquants
            );

            const results = await Promise.all(promises);
            results.forEach(q => pool = pool.concat(q));
        }

        pool.sort(() => 0.5 - Math.random());
        // Limite à 100 questions pour ne pas faire laguer le navigateur pendant le quiz
        baseQuiz.questions = pool.slice(0, 100); 
        return baseQuiz;
    },

    // --- Quiz Engine ---
    loadInMemoryQuiz: (quizObj) => {
        app.data.currentQuiz = quizObj;
        app.data.currentQuestionIndex = 0;
        app.data.userAnswers = {};
        app.data.isAnimating = false;
        
        document.getElementById('start-title').innerText = quizObj.title;
        document.getElementById('start-pass').innerText = quizObj.passPercentage || 70;
        document.getElementById('start-qcount').innerText = quizObj.questions ? quizObj.questions.length : 0;

        const infoBox = document.querySelector('.info-box p:last-child');
        if (quizObj.timeLimit) {
            infoBox.innerHTML = `<strong>⚠️ Attention :</strong> Vous avez <strong>${quizObj.timeLimit} minutes</strong> pour compléter cet examen.`;
            infoBox.style.color = "#d35400";
        } else {
            infoBox.innerHTML = "You have unlimited attempts. There is no time limit.";
            infoBox.style.color = "";
        }
        
        document.getElementById('btn-begin').onclick = app.startQuizFlow;
        app.showView('view-start');
    },

    startQuizFlow: () => {
        app.showView('view-quiz');
        app.renderQuestionNav();
        app.renderCurrentQuestion(false);

        const timerDisplay = document.getElementById('quiz-timer');
    
        if (app.data.timerInterval) clearInterval(app.data.timerInterval);

        if (app.data.currentQuiz.timeLimit) {
            timerDisplay.classList.remove('hidden');
            app.startTimer(app.data.currentQuiz.timeLimit * 60);
        } else {
            timerDisplay.classList.add('hidden');
        }
    },
    startTimer: (durationInSeconds) => {
        let timer = durationInSeconds;
        const display = document.getElementById('timer-val');
        
        const updateDisplay = () => {
            const hours = Math.floor(timer / 3600);
            const minutes = Math.floor((timer % 3600) / 60);
            const seconds = timer % 60;

            const h = hours > 0 ? (hours < 10 ? "0" + hours : hours) + ":" : "";
            const m = minutes < 10 ? "0" + minutes : minutes;
            const s = seconds < 10 ? "0" + seconds : seconds;

            display.textContent = h + m + ":" + s;
            
            // Optionnel : Passer en rouge quand il reste moins de 5 min
            if (timer < 300) display.style.color = "red";
            else display.style.color = "";
        };

        updateDisplay(); // Affichage immédiat

        app.data.timerInterval = setInterval(() => {
            timer--;
            updateDisplay();

            if (timer <= 0) {
                clearInterval(app.data.timerInterval);
                alert("Temps écoulé ! L'examen va être soumis automatiquement.");
                app.finishQuiz();
            }
        }, 1000);
    },

    changeQuestion: (direction) => {
        if (app.data.isAnimating) return;
        const newIndex = app.data.currentQuestionIndex + direction;
        const total = app.data.currentQuiz.questions.length;
        if (newIndex < 0 || newIndex >= total) return;

        app.data.isAnimating = true;
        const wrapper = document.getElementById('q-anim-wrapper');
        if(wrapper) wrapper.classList.add('fade-out');

        setTimeout(() => {
            app.data.currentQuestionIndex = newIndex;
            app.renderCurrentQuestion(true);
            requestAnimationFrame(() => {
                if(wrapper) wrapper.classList.remove('fade-out');
                setTimeout(() => { app.data.isAnimating = false; }, 300);
            });
        }, 300);
    },

    renderQuestionNav: () => {
        const map = document.getElementById('question-nav-map');
        map.innerHTML = '';
        app.data.currentQuiz.questions.forEach((q, idx) => {
            const btn = document.createElement('div');
            btn.className = 'nav-btn';
            btn.innerText = idx + 1;
            btn.onclick = () => {
                if (idx !== app.data.currentQuestionIndex && !app.data.isAnimating) {
                    app.data.isAnimating = true;
                    const wrapper = document.getElementById('q-anim-wrapper');
                    if(wrapper) wrapper.classList.add('fade-out');
                    setTimeout(() => {
                        app.data.currentQuestionIndex = idx;
                        app.renderCurrentQuestion(true);
                        requestAnimationFrame(() => {
                            if(wrapper) wrapper.classList.remove('fade-out');
                            setTimeout(() => { app.data.isAnimating = false; }, 300);
                        });
                    }, 300);
                }
            };
            map.appendChild(btn);
        });
        app.updateNavStyles();
    },

    updateNavStyles: () => {
        document.querySelectorAll('.nav-btn').forEach((btn, idx) => {
            btn.classList.remove('active');
            if (idx === app.data.currentQuestionIndex) btn.classList.add('active');
            
            const ans = app.data.userAnswers[idx];
            let isAnswered = false;
            if (Array.isArray(ans)) isAnswered = ans.length > 0;
            else if (typeof ans === 'object' && ans !== null) isAnswered = Object.keys(ans).length > 0;
            else isAnswered = ans !== undefined;

            if (isAnswered) btn.classList.add('answered');
        });
        
        const total = app.data.currentQuiz.questions.length;
        let answeredCount = 0;
        Object.values(app.data.userAnswers).forEach(v => {
            if(Array.isArray(v) && v.length > 0) answeredCount++;
            else if(typeof v === 'object' && v !== null && Object.keys(v).length > 0) answeredCount++;
            else if(!Array.isArray(v) && typeof v !== 'object' && v !== undefined) answeredCount++;
        });

        const pct = (answeredCount / total) * 100;
        document.getElementById('progress-fill').style.width = `${pct}%`;
        document.getElementById('progress-text').innerText = `Question ${app.data.currentQuestionIndex + 1} of ${total}`;
    },

    renderCurrentQuestion: (skipNavUpdate = false) => {
        const qIndex = app.data.currentQuestionIndex;
        const qData = app.data.currentQuiz.questions[qIndex];
        
        const optsContainer = document.getElementById('q-options');
        optsContainer.innerHTML = ''; 

        document.getElementById('q-number').innerText = `Question ${qIndex + 1}`;
        document.getElementById('q-text').innerText = qData.question;
        document.getElementById('quiz-title-display').innerText = app.data.currentQuiz.title;

        // Image Handling
        const imgEl = document.getElementById('q-image');
        if (qData.image) {
            const imgSrc = qData.image.startsWith('http') ? qData.image : `quizzes/images/${qData.image}`;
            imgEl.src = imgSrc;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
            imgEl.src = ''; 
        }

        const instructionEl = document.getElementById('q-instruction');
        
        // --- MATCH (Click-to-Move) ---
        if (qData.type === 'match') {
            instructionEl.innerText = "(Tap an answer in the bank to fill a slot. Tap a slot to clear it.)";
            const matchContainer = document.createElement('div');
            matchContainer.className = 'match-container';
            const currentAns = app.data.userAnswers[qIndex] || {};

            qData.pairs.forEach((pair, idx) => {
                const row = document.createElement('div');
                row.className = 'match-row';
                const prompt = document.createElement('div');
                prompt.className = 'match-prompt';
                prompt.innerText = pair.left;
                const slot = document.createElement('div');
                slot.className = 'match-slot';
                if (currentAns[idx]) {
                    slot.innerText = currentAns[idx];
                    slot.classList.add('filled');
                } else {
                    slot.innerText = "Drop here...";
                }
                slot.onclick = () => app.handleMatchSlotClick(qIndex, idx);
                row.appendChild(prompt);
                row.appendChild(slot);
                matchContainer.appendChild(row);
            });
            optsContainer.appendChild(matchContainer);

            // Bank
            const bank = document.createElement('div');
            bank.className = 'match-bank';
            let allOptions = qData.pairs.map(p => p.right);
            const usedOptions = Object.values(currentAns);
            const availableOptions = allOptions.filter(opt => !usedOptions.includes(opt));
            availableOptions.sort(() => 0.5 - Math.random());
            availableOptions.forEach(optText => {
                const chip = document.createElement('div');
                chip.className = 'match-option-chip';
                chip.innerText = optText;
                chip.onclick = () => app.handleMatchBankClick(qIndex, optText);
                bank.appendChild(chip);
            });
            optsContainer.appendChild(bank);
        }
        
        // --- DROPDOWN MATCH ---
        else if (qData.type === 'dropdown-match') {
            instructionEl.innerText = "(Select the correct option.)";
            const uniqueOptions = [...new Set(qData.pairs.map(p => p.right))].sort();
            const currentAns = app.data.userAnswers[qIndex] || {};

            qData.pairs.forEach((pair, idx) => {
                const row = document.createElement('div');
                row.className = 'dd-match-row';
                const prompt = document.createElement('div');
                prompt.className = 'dd-match-prompt';
                prompt.innerText = pair.left;
                const select = document.createElement('select');
                select.className = 'dd-match-select';
                
                const defaultOpt = document.createElement('option');
                defaultOpt.value = "";
                defaultOpt.innerText = "Select...";
                defaultOpt.disabled = true;
                if (!currentAns[idx]) defaultOpt.selected = true;
                select.appendChild(defaultOpt);

                uniqueOptions.forEach(optText => {
                    const option = document.createElement('option');
                    option.value = optText;
                    option.innerText = optText;
                    if (currentAns[idx] === optText) option.selected = true;
                    select.appendChild(option);
                });

                select.onchange = (e) => {
                    let answers = app.data.userAnswers[qIndex] || {};
                    answers[idx] = e.target.value;
                    app.data.userAnswers[qIndex] = answers;
                    app.updateNavStyles();
                };
                row.appendChild(prompt);
                row.appendChild(select);
                optsContainer.appendChild(row);
            });
        }

        // --- STANDARD ---
        else {
            const isMultiple = qData.type === 'multiple';
            instructionEl.innerText = isMultiple ? "(Select all that apply)" : "(Select one)";
            qData.options.forEach((opt, optIdx) => {
                const el = document.createElement('div');
                el.className = 'option-item';
                if (isMultiple) el.classList.add('multi');
                const currentAns = app.data.userAnswers[qIndex];
                let isSelected = false;
                if (isMultiple) isSelected = Array.isArray(currentAns) && currentAns.includes(optIdx);
                else isSelected = currentAns === optIdx;
                if (isSelected) el.classList.add('selected');
                el.innerHTML = `<span class="opt-marker"></span> <span>${opt.text}</span>`;
                el.onclick = () => app.handleOptionClick(qIndex, optIdx, isMultiple);
                optsContainer.appendChild(el);
            });
        }

        // Buttons
        const total = app.data.currentQuiz.questions.length;
        document.getElementById('btn-prev').disabled = qIndex === 0;
        const nextBtn = document.getElementById('btn-next');
        const finishBtn = document.getElementById('btn-finish');
        
        if (qIndex === total - 1) {
            nextBtn.classList.add('hidden');
            finishBtn.classList.remove('hidden');
            finishBtn.onclick = app.finishQuiz;
        } else {
            nextBtn.classList.remove('hidden');
            finishBtn.classList.add('hidden');
            nextBtn.onclick = () => app.changeQuestion(1);
        }
        document.getElementById('btn-prev').onclick = () => app.changeQuestion(-1);
        app.updateNavStyles();
    },

    // --- Handlers ---
    handleOptionClick: (qIndex, optIndex, isMultiple) => {
        if (isMultiple) {
            let current = app.data.userAnswers[qIndex] || [];
            if (!Array.isArray(current)) current = [];
            const pos = current.indexOf(optIndex);
            if (pos === -1) current.push(optIndex);
            else current.splice(pos, 1);
            app.data.userAnswers[qIndex] = current;
        } else {
            app.data.userAnswers[qIndex] = optIndex;
        }
        app.renderCurrentQuestion(true); 
    },
    handleMatchBankClick: (qIndex, answerText) => {
        let current = app.data.userAnswers[qIndex] || {};
        let targetSlot = -1;
        const qData = app.data.currentQuiz.questions[qIndex];
        for(let i=0; i<qData.pairs.length; i++) { if(!current[i]) { targetSlot = i; break; } }
        if (targetSlot !== -1) {
            current[targetSlot] = answerText;
            app.data.userAnswers[qIndex] = current;
            app.renderCurrentQuestion(true); 
        }
    },
    handleMatchSlotClick: (qIndex, slotIndex) => {
        let current = app.data.userAnswers[qIndex];
        if (current && current[slotIndex]) {
            delete current[slotIndex];
            app.data.userAnswers[qIndex] = current;
            app.renderCurrentQuestion(true); 
        }
    },

    // --- Score & Custom ---
    finishQuiz: () => {
        if (app.data.timerInterval) clearInterval(app.data.timerInterval);
        const total = app.data.currentQuiz.questions.length;
        let correctCount = 0;
        app.data.currentQuiz.questions.forEach((q, idx) => {
            const userAns = app.data.userAnswers[idx];
            if (q.type === 'match' || q.type === 'dropdown-match') {
                if (userAns && Object.keys(userAns).length === q.pairs.length) {
                    let allCorrect = true;
                    q.pairs.forEach((pair, pairIdx) => {
                        if (userAns[pairIdx] !== pair.right) allCorrect = false;
                    });
                    if (allCorrect) correctCount++;
                }
            } else if (q.type === 'multiple') {
                const correctIndices = q.options.map((opt, i) => opt.isCorrect ? i : -1).filter(i => i !== -1);
                const userIndices = Array.isArray(userAns) ? userAns : [];
                const isCorrect = correctIndices.length === userIndices.length && correctIndices.every(val => userIndices.includes(val));
                if (isCorrect) correctCount++;
            } else {
                if (userAns !== undefined && q.options[userAns].isCorrect) correctCount++;
            }
        });

        const score = Math.round((correctCount / total) * 100);
        const pass = app.data.currentQuiz.passPercentage || 70;
        document.getElementById('result-score').innerText = `${score}%`;
        document.getElementById('result-msg').innerText = score >= pass ? "Réussi !" : "Échec.";
        
        if (app.data.currentQuiz.type === 'custom') {
            document.getElementById('btn-save-custom').classList.remove('hidden');
        } else {
            document.getElementById('btn-save-custom').classList.add('hidden');
        }
        app.showView('view-result');
    },

    resetQuiz: () => { app.loadInMemoryQuiz(app.data.currentQuiz); },

    startReview: () => {
        const container = document.getElementById('review-container');
        container.innerHTML = '';
        app.data.currentQuiz.questions.forEach((q, idx) => {
            const userAns = app.data.userAnswers[idx];
            const item = document.createElement('div');
            item.className = 'review-item';
            let html = `<h4>${idx + 1}. ${q.question}</h4>`;

            if (q.type === 'match' || q.type === 'dropdown-match') {
                html += `<div style="background:#f9f9f9; padding:10px;">`;
                q.pairs.forEach((pair, pairIdx) => {
                    const userVal = userAns ? userAns[pairIdx] : "Vide";
                    const isCorrect = userVal === pair.right;
                    html += `<div style="border-bottom:1px solid #eee; padding:5px;">
                        <span>${pair.left}</span><br>
                        ${isCorrect ? `<b style="color:green">✔ ${userVal}</b>` : `<span style="color:red">${userVal}</span> <b style="color:green">➝ ${pair.right}</b>`}
                    </div>`;
                });
                html += `</div>`;
            } else {
                q.options.forEach((opt, optIdx) => {
                    const isMultiple = q.type === 'multiple';
                    let marker = '';
                    let userSelected = false;
                    if (isMultiple) userSelected = Array.isArray(userAns) && userAns.includes(optIdx);
                    else userSelected = userAns === optIdx;
                    
                    let style = "padding:8px; border:1px solid #eee; margin:2px;";
                    if(opt.isCorrect) style += "background:#dff0d8; color:#3c763d;"; 
                    if(userSelected && !opt.isCorrect) style += "background:#f2dede; color:#a94442;";
                    if(userSelected) marker = " <strong>(Votre choix)</strong>";
                    
                    html += `<div style="${style}">${opt.text} ${marker}</div>`;
                });
            }
            if (q.explanation) html += `<div class="explanation"><strong>Note:</strong> ${q.explanation}</div>`;
            item.innerHTML = html;
            container.appendChild(item);
        });
        app.showView('view-review');
    },

    renderCustomBuilder: () => {
        const list = document.getElementById('builder-module-list');
        list.innerHTML = '';
        if(!app.data.manifest) return;
        app.data.manifest.modules.forEach(m => {
            const label = document.createElement('label');
            label.className = 'cb-item';
            label.innerHTML = `<input type="checkbox" value="${m.id}" class="mod-cb"> ${m.title}`;
            list.appendChild(label);
        });
    },

    generateCustomQuiz: async () => {
        const selected = Array.from(document.querySelectorAll('.mod-cb:checked')).map(cb => cb.value);
        if (selected.length === 0) { alert("Sélectionnez au moins un module."); return; }
        
        const count = parseInt(document.getElementById('custom-count').value) || 20;
        const title = document.getElementById('custom-title').value || "Custom Quiz";
        
        if (app.data.abortController) app.data.abortController.abort();
        app.data.abortController = new AbortController();
        const signal = app.data.abortController.signal;

        const loader = document.getElementById('app-loader');
        loader.classList.remove('hidden');

        try {
            let pool = [];
            // Batch loading for custom quiz
            const modulesToFetch = app.data.manifest.modules.filter(m => selected.includes(m.id));
            const batchSize = 5;
            
            for (let i = 0; i < modulesToFetch.length; i += batchSize) {
                if(signal.aborted) throw new Error("AbortError");
                const batch = modulesToFetch.slice(i, i + batchSize);
                const promises = batch.map(m => 
                    app.fetchJson(m.file, signal)
                        .then(data => data.questions || [])
                        .catch(() => [])
                );
                const results = await Promise.all(promises);
                results.forEach(qs => pool = pool.concat(qs));
            }

            pool.sort(() => 0.5 - Math.random());
            const finalQuestions = pool.slice(0, count);
            const customQuiz = { 
                id: 'custom-' + Date.now(), 
                type: 'custom', 
                title: title, 
                passPercentage: 70, 
                questions: finalQuestions, 
                createdFrom: selected 
            };
            
            if(!signal.aborted) app.loadInMemoryQuiz(customQuiz);

        } catch(e) {
            if(e.name !== 'AbortError') alert("Erreur lors de la génération.");
        } finally {
            if(!signal.aborted) loader.classList.add('hidden');
        }
    },

    saveCustomQuiz: () => {
        const quiz = app.data.currentQuiz;
        if (quiz.type !== 'custom') return;
        const saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        saved.push(quiz);
        localStorage.setItem('customQuizzes', JSON.stringify(saved));
        alert("Quiz sauvegardé !");
        app.renderSavedCustom();
    }
};

window.onload = app.init;