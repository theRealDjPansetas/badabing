/*
  dfa2table.c

  PURPOSE
    Read a DFA given in "transition function" text form and output the machine-parsable .dfa format
    used by our checker.

  INPUT (user DFA spec) format (whitespace flexible):

    Start: q0
    Accept: {q0, q2, q4}
    (q0, a) -> q1
    (q1, a) -> q1
    (q1, b) -> q2
    ...

  - State names must be q<nonnegative integer> (e.g., q0, q12).
  - Symbols are single-byte characters from the alphabet.
  - Missing transitions are allowed; we will add a DEAD state to complete the DFA.

  USAGE
    ./dfa2table <alphabet_string> <user_spec.txt> <out.dfa>

    alphabet_string must be exactly the k alphabet symbols with no separators, e.g. "ab01"

  OUTPUT (.dfa, strict)
    ALPHABET k <alphabet_string>
    STATES n
    START s
    ACCEPT m a0 a1 ...
    TRANS
    <n rows of k integers>
    END

  COMPILE
    gcc -O2 -Wall -Wextra -std=c11 dfa2table.c -o dfa2table
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define MAX_ALPHABET 128
#define MAX_STATES   4096
#define MAX_LINE     8192

static void die(const char* msg){
    fprintf(stderr, "Error: %s\n", msg);
    exit(1);
}
static void* xmalloc(size_t n){ void* p=malloc(n); if(!p) die("out of memory"); return p; }
static void* xcalloc(size_t n,size_t s){ void* p=calloc(n,s); if(!p) die("out of memory"); return p; }
static void* xrealloc(void* p,size_t n){ void* q=realloc(p,n); if(!q) die("out of memory"); return q; }

typedef struct {
    int k;
    char alphabet[MAX_ALPHABET];
} Alphabet;

static int alph_index(const Alphabet* A, char c){
    for(int i=0;i<A->k;i++) if(A->alphabet[i]==c) return i;
    return -1;
}

static int parse_q_state(const char* s, int* out_val){
    // expects 'q' then digits, no trailing junk (but we allow trailing punctuation like ',' or '}' handled outside)
    if(s[0] != 'q') return 0;
    if(!isdigit((unsigned char)s[1])) return 0;
    long v=0;
    for(int i=1; s[i]; i++){
        if(!isdigit((unsigned char)s[i])) return 0;
        v = v*10 + (s[i]-'0');
        if(v > 1000000) return 0;
    }
    *out_val = (int)v;
    return 1;
}

static void trim(char* s){
    // trim leading/trailing whitespace
    char* p=s;
    while(*p && isspace((unsigned char)*p)) p++;
    if(p!=s) memmove(s,p,strlen(p)+1);
    size_t n=strlen(s);
    while(n>0 && isspace((unsigned char)s[n-1])) s[--n]='\0';
}

static void remove_trailing_punct(char* s){
    // remove trailing commas, braces
    size_t n=strlen(s);
    while(n>0 && (s[n-1]==',' || s[n-1]=='}' || s[n-1]==')')) s[--n]='\0';
}

static void validate_alphabet(const char* alph, Alphabet* A){
    int seen[256]={0};
    int k=(int)strlen(alph);
    if(k<=0 || k>MAX_ALPHABET) die("bad alphabet_string length");
    for(int i=0;i<k;i++){
        unsigned char uc=(unsigned char)alph[i];
        char c=alph[i];
        if(uc < 32) die("alphabet has non-printable byte");
        if(c=='('||c==')'||c=='{'||c=='}'||c==','||c=='-'||c=='>'||c==':' ) die("alphabet contains forbidden punctuation");
        if(seen[uc]) die("alphabet has duplicate symbol");
        seen[uc]=1;
        A->alphabet[i]=c;
    }
    A->k=k;
}

static void ensure_state_capacity(int q, int* max_q){
    if(q < 0 || q >= MAX_STATES) die("state index too large");
    if(q > *max_q) *max_q = q;
}

int main(int argc, char** argv){
    if(argc != 4){
        fprintf(stderr,"Usage: %s <alphabet_string> <user_spec.txt> <out.dfa>\n", argv[0]);
        return 1;
    }

    Alphabet A;
    validate_alphabet(argv[1], &A);

    const char* inpath = argv[2];
    const char* outpath= argv[3];

    FILE* f = fopen(inpath, "r");
    if(!f) die("cannot open user_spec.txt");

    int start_q = -1;
    unsigned char* accepting = (unsigned char*)xcalloc(MAX_STATES, 1);
    int acc_seen_any = 0;

    // transitions as dynamic table over discovered max state
    // We'll store in a flat array trans[state*k + sym] with -1 initially.
    int max_q = -1;
    int* trans = (int*)xmalloc((size_t)MAX_STATES*(size_t)A.k*sizeof(int));
    for(int i=0;i<MAX_STATES*A.k;i++) trans[i] = -1;

    char line[MAX_LINE];
    int line_no=0;

    while(fgets(line, sizeof(line), f)){
        line_no++;
        trim(line);
        if(line[0]=='\0') continue;
        if(line[0]=='#') continue;

        // Start line
        if(strncmp(line, "Start:", 6)==0 || strncmp(line, "START:", 6)==0){
            char* p = strchr(line, ':');
            if(!p) die("bad Start line");
            p++;
            while(*p && isspace((unsigned char)*p)) p++;
            // read token
            char tok[256]={0};
            int j=0;
            while(*p && !isspace((unsigned char)*p) && j<250) tok[j++]=*p++;
            tok[j]='\0';
            remove_trailing_punct(tok);

            int q=-1;
            if(!parse_q_state(tok, &q)){
                die("Start line must be: Start: q<number>");
            }
            ensure_state_capacity(q, &max_q);
            start_q = q;
            continue;
        }

        // Accept line
        if(strncmp(line, "Accept:", 7)==0 || strncmp(line, "ACCEPT:", 7)==0){
            char* p = strchr(line, ':');
            if(!p) die("bad Accept line");
            p++;
            // We accept braces or no braces; parse tokens that look like q\d+
            acc_seen_any = 1;

            // tokenize by space, comma, braces
            char buf[MAX_LINE];
            strncpy(buf, p, sizeof(buf)-1);
            buf[sizeof(buf)-1]='\0';

            for(size_t i=0;i<strlen(buf);i++){
                if(buf[i]=='{'||buf[i]=='}'||buf[i]==',' ) buf[i]=' ';
            }

            char* save=NULL;
            char* tok=strtok_r(buf, " \t", &save);
            while(tok){
                remove_trailing_punct(tok);
                int q=-1;
                if(parse_q_state(tok,&q)){
                    ensure_state_capacity(q,&max_q);
                    accepting[q]=1;
                } else if(tok[0]!='\0') {
                    // ignore junk tokens
                }
                tok=strtok_r(NULL, " \t", &save);
            }
            continue;
        }

        // Transition line: (qX, a) -> qY
        // We'll parse by scanning for q and symbol.
        {
            // remove spaces for easier parse? We'll just use sscanf with patterns.
            // Expect: (q%d,%c)->q%d possibly with spaces
            int from=-1, to=-1;
            char sym=0;

            // Try a tolerant parse: find '(' then 'q' digits, then comma, then symbol char, then ')', then '->', then 'q' digits
            char* p = line;
            while(*p && *p!='(') p++;
            if(*p!='(') {
                // unknown line
                continue;
            }
            p++;
            while(*p && isspace((unsigned char)*p)) p++;
            if(*p!='q') {
                fprintf(stderr,"Error: line %d: bad transition (missing q)\n", line_no);
                return 1;
            }
            p++;
            if(!isdigit((unsigned char)*p)) { fprintf(stderr,"Error: line %d: bad from-state\n", line_no); return 1; }
            long v=0;
            while(isdigit((unsigned char)*p)){ v=v*10+(*p-'0'); p++; if(v>1000000) break; }
            from=(int)v;

            while(*p && *p!=',') p++;
            if(*p!=','){ fprintf(stderr,"Error: line %d: bad transition (missing comma)\n", line_no); return 1; }
            p++;
            while(*p && isspace((unsigned char)*p)) p++;

            if(*p=='\0'){ fprintf(stderr,"Error: line %d: missing symbol\n", line_no); return 1; }
            sym=*p;
            p++;

            // verify symbol in alphabet
            if(alph_index(&A, sym) < 0){
                fprintf(stderr,"Error: line %d: symbol '%c' not in alphabet\n", line_no, sym);
                return 1;
            }

            // find '->'
            char* arrow = strstr(p, "->");
            if(!arrow){ fprintf(stderr,"Error: line %d: missing ->\n", line_no); return 1; }
            p = arrow + 2;
            while(*p && isspace((unsigned char)*p)) p++;
            if(*p!='q'){ fprintf(stderr,"Error: line %d: bad to-state (missing q)\n", line_no); return 1; }
            p++;
            if(!isdigit((unsigned char)*p)){ fprintf(stderr,"Error: line %d: bad to-state digits\n", line_no); return 1; }
            v=0;
            while(isdigit((unsigned char)*p)){ v=v*10+(*p-'0'); p++; if(v>1000000) break; }
            to=(int)v;

            ensure_state_capacity(from, &max_q);
            ensure_state_capacity(to, &max_q);

            int ai = alph_index(&A, sym);
            int idx = from*A.k + ai;
            if(trans[idx] != -1 && trans[idx] != to){
                fprintf(stderr,"Error: line %d: nondeterministic transition for (q%d,%c)\n", line_no, from, sym);
                return 1;
            }
            trans[idx] = to;
        }
    }

    fclose(f);

    if(start_q < 0) die("missing Start line");
    if(!acc_seen_any) die("missing Accept line");

    int n_states = max_q + 1;

    // Check whether we need a dead state to complete DFA
    int need_dead = 0;
    for(int s=0;s<n_states;s++){
        for(int a=0;a<A.k;a++){
            if(trans[s*A.k + a] == -1) { need_dead=1; break; }
        }
        if(need_dead) break;
    }

    int dead = -1;
    int out_n = n_states + (need_dead ? 1 : 0);
    if(need_dead){
        dead = out_n - 1;
        // dead state is non-accepting
        accepting[dead] = 0;
        // fill dead transitions to itself
        for(int a=0;a<A.k;a++) trans[dead*A.k + a] = dead;
    }

    // fill missing transitions to dead
    if(need_dead){
        for(int s=0;s<n_states;s++){
            for(int a=0;a<A.k;a++){
                int idx = s*A.k + a;
                if(trans[idx] == -1) trans[idx] = dead;
            }
        }
    } else {
        // If no dead, ensure none missing
        for(int s=0;s<n_states;s++){
            for(int a=0;a<A.k;a++){
                if(trans[s*A.k + a] == -1){
                    die("internal error: missing transition without dead");
                }
            }
        }
    }

    // Build accepting list
    int m=0;
    for(int s=0;s<out_n;s++) if(accepting[s]) m++;

    FILE* out = fopen(outpath, "w");
    if(!out) die("cannot open output file");

    fprintf(out, "ALPHABET %d ", A.k);
    for(int i=0;i<A.k;i++) fputc(A.alphabet[i], out);
    fprintf(out, "\n");
    fprintf(out, "STATES %d\n", out_n);
    fprintf(out, "START %d\n", start_q);
    fprintf(out, "ACCEPT %d", m);
    for(int s=0;s<out_n;s++) if(accepting[s]) fprintf(out, " %d", s);
    fprintf(out, "\n");
    fprintf(out, "TRANS\n");
    for(int s=0;s<out_n;s++){
        for(int a=0;a<A.k;a++){
            int t = trans[s*A.k + a];
            if(t < 0 || t >= out_n) die("transition out of range after completion");
            fprintf(out, "%d%s", t, (a==A.k-1)?"":" ");
        }
        fprintf(out, "\n");
    }
    fprintf(out, "END\n");
    fclose(out);

    free(accepting);
    free(trans);
    return 0;
}
